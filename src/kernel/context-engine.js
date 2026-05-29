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
  // P0: project manifest — always hot, always in context
  "package.json": 0,
  "pyproject.toml": 0,
  "Cargo.toml": 0,
  "go.mod": 0,
  // P1: project documentation/configuration — hot
  "README.md": 1,
  "tsconfig.json": 1,
  ".gitignore": 1,
  // P2: secondary config (still hot, but lower than P1)
  // Makefile, Dockerfile, LICENSE etc. are now default P3 —
  // they're recognized as text but not auto-promoted to hot
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

const EXTENSIONLESS_TEXT_FILES = new Set([
  "Makefile", "Dockerfile", "LICENSE", "CHANGELOG", "NOTICE",
  "AUTHORS", "CONTRIBUTORS", "TODO"
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

  async function prune() {
    const toRemove = [];
    for (const [source, unit] of units) {
      const target = path.resolve(root, source);
      try {
        await fs.stat(target);
      } catch (err) {
        if (err.code === "ENOENT") {
          toRemove.push(source);
          warmSet.delete(unit.id);
          pinned.delete(source);
        }
      }
    }
    for (const source of toRemove) {
      units.delete(source);
    }
    return toRemove.length;
  }

  function invalidate(filePath) {
    const unit = units.get(filePath);
    if (!unit) return Promise.resolve();
    return readTextFile(root, filePath, 64000).then((content) => {
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
    }).catch((err) => {
      // Log failure so callers can detect stale state
      console.error(`ContextEngine: failed to invalidate ${filePath}: ${err.message}`);
    });
  }

  function snapshot(phase, channel, options = {}) {
    const budget = channelConfigs[channel]?.maxBudget
      || CHANNEL_BUDGETS[channel]
      || 64000;
    const maxPriority = CHANNEL_MAX_PRIORITY[channel] ?? 2;
    const selected = [];
    let used = 0;

    for (const unit of sortedUnits()) {
      if (unit.priority > maxPriority && unit.priority !== 4 && !warmSet.has(unit.id)) continue;
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
    const hotIds = new Set(hotUnits.map(u => u.id));
    // warm = in warmSet but NOT already counted as hot
    const warmOnly = [...warmSet].filter(id => !hotIds.has(id));
    // cold = everything else
    const coldCount = allUnits.length - hotUnits.length - warmOnly.length;
    return {
      total_units: allUnits.length,
      hot_units: hotUnits.length,
      warm_units: warmOnly.length,
      cold_units: Math.max(0, coldCount),
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
    // Default: P3 — cold tier until explicitly warmed
    return 3;
  }

  function sortedUnits() {
    return [...units.values()].sort((a, b) => {
      // P0-P2 come before P3-P4
      const tierA = a.priority <= 2 ? 0 : 1;
      const tierB = b.priority <= 2 ? 0 : 1;
      if (tierA !== tierB) return tierA - tierB;
      // Within tier 0: ascending priority (P0 first, then P1, P2)
      // Within tier 1: ascending priority (P3 first, then pinned P4)
      return a.priority - b.priority;
    });
  }

  function estimateCacheOffset(selectedUnits, channel) {
    // Stable cache prefix = P0 units only (project manifests that rarely change)
    let offset = 0;
    for (const unit of selectedUnits) {
      if (unit.priority === 0) offset += unit.token_count;
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
    invalidate, snapshot, getCacheStats, setChannelConfig, prune
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
  const resolvedRoot = path.resolve(rootDir);
  const target = path.resolve(resolvedRoot, relativePath);

  // Check that target is within rootDir using path.relative
  const rel = path.relative(resolvedRoot, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }

  const stat = await fs.stat(target);
  if (stat.size > maxBytes) throw new Error(`File too large: ${relativePath}`);
  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) throw new Error(`Binary file: ${relativePath}`);
  return buffer.toString("utf8");
}

function isLikelyText(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(file);
  if (EXTENSIONLESS_TEXT_FILES.has(base)) return true;
  if (base.includes(".")) return true;
  return false;
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
