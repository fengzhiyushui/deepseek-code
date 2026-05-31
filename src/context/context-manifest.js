import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nowIso } from "../shared/time.js";

export const CONTEXT_MANIFEST_SCHEMA_VERSION = 1;

const RECORD_KEYS = [
  "path",
  "hash",
  "bytes",
  "token_count",
  "priority",
  "reason",
  "mtime_ms",
  "size",
  "indexed_at",
  "policy_version"
];

export function projectRootHash(root) {
  return `sha256:${createHash("sha256").update(path.resolve(root)).digest("hex")}`;
}

export function createEmptyManifest({ root, now = nowIso() } = {}) {
  if (!root) throw new Error("root is required");
  return {
    schema_version: CONTEXT_MANIFEST_SCHEMA_VERSION,
    project_root_hash: projectRootHash(root),
    created_at: now,
    updated_at: now,
    files: {},
    stats: {
      indexed_files: 0,
      skipped_files: 0,
      reused_files: 0,
      changed_files: 0
    }
  };
}

export async function loadContextManifest({ manifestPath, root } = {}) {
  if (!manifestPath) throw new Error("manifestPath is required");
  if (!root) throw new Error("root is required");
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.schema_version !== CONTEXT_MANIFEST_SCHEMA_VERSION) return createEmptyManifest({ root });
    if (parsed.project_root_hash !== projectRootHash(root)) return createEmptyManifest({ root });
    const manifest = createEmptyManifest({ root, now: parsed.created_at || nowIso() });
    manifest.updated_at = parsed.updated_at || manifest.created_at;
    manifest.stats = { ...manifest.stats, ...(parsed.stats || {}) };
    for (const [recordPath, record] of Object.entries(parsed.files || {})) {
      const safe = sanitizeManifestRecord({ ...record, path: record.path || recordPath });
      if (safe.path) manifest.files[safe.path] = safe;
    }
    return manifest;
  } catch {
    return createEmptyManifest({ root });
  }
}

export async function saveContextManifest({ manifestPath, manifest } = {}) {
  if (!manifestPath) throw new Error("manifestPath is required");
  if (!manifest) throw new Error("manifest is required");
  const clean = sanitizeManifest(manifest);
  clean.updated_at = nowIso();
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, manifestPath);
  return clean;
}

export function sanitizeManifest(manifest) {
  const clean = {
    schema_version: CONTEXT_MANIFEST_SCHEMA_VERSION,
    project_root_hash: manifest.project_root_hash,
    created_at: manifest.created_at || nowIso(),
    updated_at: manifest.updated_at || nowIso(),
    files: {},
    stats: { ...(manifest.stats || {}) }
  };
  for (const [recordPath, record] of Object.entries(manifest.files || {})) {
    const safe = sanitizeManifestRecord({ ...record, path: record.path || recordPath });
    if (safe.path) clean.files[safe.path] = safe;
  }
  return clean;
}

export function sanitizeManifestRecord(record = {}) {
  const clean = {};
  for (const key of RECORD_KEYS) {
    if (record[key] !== undefined) clean[key] = record[key];
  }
  return clean;
}
