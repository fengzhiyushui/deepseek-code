// src/kernel/context-engine.js
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const CHANNEL_BUDGETS = {
  think: 500000,
  act: 64000
};

const CHANNEL_MAX_PRIORITY = {
  think: 2,
  act: 1
};

const PRIORITY_RANK = {
  "README.md": 3,
  "package.json": 3,
  "tsconfig.json": 3,
  "pyproject.toml": 3,
  "Cargo.toml": 3,
  "go.mod": 3,
  ".gitignore": 2
};

const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".conf", ".cpp", ".cs", ".css", ".csv",
  ".go", ".h", ".hpp", ".html", ".java", ".js", ".json",
  ".jsx", ".md", ".mjs", ".py", ".rs", ".sql", ".ts",
  ".tsx", ".txt", ".xml", ".yaml", ".yml"
]);

const IGNORE_DIRS = new Set([
  ".git", ".deepseek-code", "node_modules", "dist", "build",
  "coverage", ".next", ".nuxt", ".turbo", ".cache", "target",
  "vendor", "__pycache__"
]);

export function createContextEngine(root) {
  const units = new Map();
  const pinned = new Set();
  const warmSet = new Set();
  const channelConfigs = {};

  async function scan() {
    const files = await listProjectFiles(root);
    for (const file of files) {
      if (!isLikelyText(file)) continue;
      try {
        const content = await readTextFile(root, file, 64000);
        const unit = createUnit(file, content);
        units.set(file, unit);
      } catch {
        // skip unreadable files
      }
    }
  }

  function getUnit(source) {
    return units.get(source);
  }

  function pin(filePath) {
    if (pinned.size >= 5) return;
    pinned.add(filePath);
    const unit = units.get(filePath);
    if (unit) unit.priority = 4;
  }

  function unpin(filePath) {
    pinned.delete(filePath);
    const unit = units.get(filePath);
    if (unit) unit.priority = defaultPriority(filePath);
  }

  function warm(filePath) {
    const unit = units.get(filePath);
    if (unit) warmSet.add(unit.id);
  }

  function evict(filePath) {
    const unit = units.get(filePath);
    if (unit) warmSet.delete(unit.id);
  }

  function invalidate(filePath) {
    const unit = units.get(filePath);
    if (!unit) return;
    readTextFile(root, filePath, 64000).then((content) => {
      const newHash = hashContent(content);
      if (newHash !== unit.hash) {
        unit.hash = newHash;
        unit.token_count = estimateTokens(content);
        unit.freshness = new Date().toISOString();
        unit.content_ref = newHash;
        for (const [src, other] of units) {
          if (other.dependencies?.includes(filePath)) {
            warmSet.delete(other.id);
          }
        }
      }
    }).catch(() => {});
  }

  function snapshot(phase, channel, options = {}) {
    const budget = channelConfigs[channel]?.maxBudget
      || CHANNEL_BUDGETS[channel]
      || 64000;
    const maxPriority = CHANNEL_MAX_PRIORITY[channel] ?? 2;
    const selected = [];
    let used = 0;

    for (const unit of sortedUnits()) {
      if (unit.priority > maxPriority && unit.priority !== 4) continue;
      if (used + unit.token_count > budget) break;
      selected.push(unit);
      used += unit.token_count;
    }

    const unitIds = selected.map(u => u.id);
    const unitHashes = selected.map(u => u.hash);
    const cacheOffset = estimateCacheOffset(selected, channel);

    return {
      snapshot_id: `snap_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      channel,
      phase: phase || "unknown",
      units: unitIds,
      unit_hashes: unitHashes,
      assembly_order: describeAssembly(selected),
      compression_policy_id: `${channel}_v1`,
      expected_cache_prefix_offset: cacheOffset,
      file_revision_hashes: Object.fromEntries(
        selected.filter(u => u.type === "file").map(u => [u.source, u.hash])
      ),
      budget: { allocated: budget, used }
    };
  }

  function getCacheStats() {
    const allUnits = [...units.values()];
    const hotUnits = allUnits.filter(u => u.priority <= 2 || pinned.has(u.source));
    return {
      total_units: allUnits.length,
      hot_units: hotUnits.length,
      warm_units: warmSet.size,
      cold_units: allUnits.length - hotUnits.length - warmSet.size,
      pinned_count: pinned.size
    };
  }

  function setChannelConfig(channel, cfg) {
    channelConfigs[channel] = { ...channelConfigs[channel], ...cfg };
  }

  // --- internal helpers ---

  function createUnit(source, content) {
    const h = hashContent(content);
    return {
      id: `unit_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      type: "file",
      source,
      content_ref: h,
      token_count: estimateTokens(content),
      hash: h,
      freshness: new Date().toISOString(),
      priority: pinned.has(source) ? 4 : defaultPriority(source),
      dependencies: []
    };
  }

  function defaultPriority(filePath) {
    const base = path.basename(filePath);
    if (PRIORITY_RANK[base] !== undefined) return PRIORITY_RANK[base];
    return 1;
  }

  function sortedUnits() {
    return [...units.values()].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.source.localeCompare(b.source);
    });
  }

  function estimateCacheOffset(selectedUnits, channel) {
    let offset = 0;
    for (const unit of selectedUnits) {
      if (unit.priority >= 3) offset += unit.token_count;
    }
    return offset;
  }

  function describeAssembly(units) {
    const byPriority = {};
    for (const u of units) {
      const p = `P${u.priority}`;
      if (!byPriority[p]) byPriority[p] = [];
      byPriority[p].push(u.source);
    }
    return Object.keys(byPriority).sort().map(p => `${p}:${byPriority[p].length} units`);
  }

  return {
    scan, getUnit, pin, unpin, warm, evict,
    invalidate, snapshot, getCacheStats, setChannelConfig
  };
}

// --- standalone helpers ---

async function listProjectFiles(rootDir, maxFiles = 1000) {
  const result = [];
  async function walk(current) {
    if (result.length >= maxFiles) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".gitignore" && entry.name !== ".env.example") {
        if (entry.isDirectory()) continue;
        if (entry.name !== ".gitignore") continue;
      }
      const absolute = path.join(current, entry.name);
      const relative = toPosix(path.relative(rootDir, absolute));
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(absolute);
      } else if (entry.isFile()) {
        result.push(relative);
      }
    }
  }
  await walk(rootDir);
  return result;
}

async function readTextFile(rootDir, relativePath, maxBytes = 200000) {
  const target = path.resolve(rootDir, relativePath);
  if (!target.startsWith(path.resolve(rootDir))) {
    throw new Error(`Path escape: ${relativePath}`);
  }
  const stat = await fs.stat(target);
  if (stat.size > maxBytes) throw new Error(`File too large: ${relativePath}`);
  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) throw new Error(`Binary file: ${relativePath}`);
  return buffer.toString("utf8");
}

function isLikelyText(file) {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
    || path.basename(file).includes(".");
}

function estimateTokens(content) {
  return Math.ceil(Buffer.byteLength(content, "utf8") / 3.5);
}

function hashContent(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}
