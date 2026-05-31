import { promises as fs } from "node:fs";
import path from "node:path";
import { nowIso } from "../shared/time.js";
import {
  normalizeRelativePath,
  readWorkspaceTextFile,
  resolveWorkspacePath,
  walkWorkspaceFiles
} from "../workspace/path-safety.js";
import { createContextRecord, hydrateContextUnit } from "./context-unit.js";
import { contextSkipReason } from "./workspace-indexer.js";
import {
  createEmptyManifest,
  loadContextManifest,
  sanitizeManifestRecord,
  saveContextManifest
} from "./context-manifest.js";

const DEFAULT_OPTIONS = Object.freeze({
  persistent: true,
  manifestName: "manifest.json",
  maxFiles: 1000,
  maxFileBytes: 64 * 1024,
  maxSnippetBytes: 4000,
  policyVersion: "v2-10"
});

export async function scanContextWithCache({ root, options = {}, eventBus = null } = {}) {
  if (!root) throw new Error("root is required");
  const started = Date.now();
  const settings = normalizeCacheOptions(root, options);
  const manifestPath = path.join(settings.cacheRoot, settings.manifestName);
  const manifest = settings.persistent
    ? await loadContextManifest({ manifestPath, root })
    : createEmptyManifest({ root });
  const records = new Map();
  const stats = {
    scanned_files: 0,
    indexed_files: 0,
    skipped_files: 0,
    reused_files: 0,
    changed_files: 0,
    skipped_reasons: {},
    manifest_loaded: settings.persistent,
    manifest_saved: false,
    scan_duration_ms: 0
  };

  if (settings.persistent) {
    eventBus?.publish?.("context:cache_loaded", { files: Object.keys(manifest.files || {}).length });
  }

  const files = await walkWorkspaceFiles(root, ".", { maxFiles: settings.maxFiles });
  const cacheRootRel = settings.persistent
    ? normalizeRelativePath(path.relative(root, settings.cacheRoot)) + "/"
    : null;
  for (const file of files) {
    stats.scanned_files += 1;
    if (cacheRootRel && normalizeRelativePath(file).startsWith(cacheRootRel)) {
      recordSkip(stats, "cache-root");
      continue;
    }
    const skip = contextSkipReason(file);
    if (skip) {
      recordSkip(stats, skip);
      continue;
    }

    try {
      const stat = await statWorkspaceFile(root, file);
      const previous = manifest.files?.[normalizeRelativePath(file)];
      if (canReuseRecord(previous, stat, settings.policyVersion)) {
        records.set(previous.path, previous);
        stats.reused_files += 1;
        stats.indexed_files += 1;
        continue;
      }

      const text = await readWorkspaceTextFile(root, file, { maxBytes: settings.maxFileBytes });
      const record = sanitizeManifestRecord(createContextRecord({
        path: text.path,
        content: text.content,
        stat,
        maxSnippetBytes: settings.maxSnippetBytes,
        now: nowIso(),
        policyVersion: settings.policyVersion
      }));
      records.set(record.path, record);
      stats.changed_files += 1;
      stats.indexed_files += 1;
    } catch (error) {
      recordSkip(stats, classifyReadError(error));
    }
  }

  stats.scan_duration_ms = Date.now() - started;
  if (settings.persistent) {
    const nextManifest = createEmptyManifest({ root });
    nextManifest.files = Object.fromEntries(records);
    nextManifest.stats = {
      indexed_files: stats.indexed_files,
      skipped_files: stats.skipped_files,
      reused_files: stats.reused_files,
      changed_files: stats.changed_files
    };
    await saveContextManifest({ manifestPath, manifest: nextManifest });
    stats.manifest_saved = true;
    eventBus?.publish?.("context:cache_saved", {
      files: records.size,
      reused_files: stats.reused_files,
      changed_files: stats.changed_files,
      skipped_files: stats.skipped_files,
      duration_ms: stats.scan_duration_ms
    });
    if (stats.reused_files > 0) {
      eventBus?.publish?.("context:cache_reused", {
        files: records.size,
        reused_files: stats.reused_files,
        changed_files: stats.changed_files,
        duration_ms: stats.scan_duration_ms
      });
    }
  }

  return { records, stats, manifestPath: settings.persistent ? manifestPath : null };
}

export async function hydrateContextRecords({ root, records = [], options = {} } = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const units = [];
  const stats = { hydrated_files: 0, hydrate_skipped_files: 0 };
  for (const record of records) {
    try {
      const text = await readWorkspaceTextFile(root, record.path, { maxBytes: settings.maxFileBytes });
      units.push(hydrateContextUnit(record, text.content, { maxSnippetBytes: settings.maxSnippetBytes }));
      stats.hydrated_files += 1;
    } catch {
      stats.hydrate_skipped_files += 1;
    }
  }
  return { units, stats };
}

export function normalizeCacheOptions(root, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  return {
    ...settings,
    cacheRoot: settings.cacheRoot || path.join(root, ".deepseek-code", "v2", "context")
  };
}

function canReuseRecord(record, stat, policyVersion) {
  return Boolean(
    record &&
    record.size === stat.size &&
    record.mtime_ms === stat.mtimeMs &&
    record.policy_version === policyVersion
  );
}

async function statWorkspaceFile(root, file) {
  const resolved = await resolveWorkspacePath(root, file, { mustExist: true });
  const stat = await fs.stat(resolved.real);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

function classifyReadError(error) {
  const message = String(error?.message || "");
  if (message.includes("binary file refused")) return "binary";
  if (message.includes("file too large")) return "too-large";
  if (message.includes("path escapes project root")) return "path-escape";
  return "unreadable";
}

function recordSkip(stats, reason) {
  stats.skipped_files += 1;
  stats.skipped_reasons[reason] = (stats.skipped_reasons[reason] || 0) + 1;
}
