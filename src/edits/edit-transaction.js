import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace/path-safety.js";
import { applyUnifiedDiff } from "../patch.js";

export function hashContent(content) {
  const value = String(content ?? "");
  return {
    hash: `sha256:${createHash("sha256").update(value).digest("hex")}`,
    bytes: Buffer.byteLength(value, "utf8")
  };
}

export async function snapshotTouchedFiles(projectRoot, patches = []) {
  if (!projectRoot) throw new Error("projectRoot is required");
  const snapshots = [];
  for (const patch of patches) {
    const filePath = patch.newPath === "/dev/null" ? patch.oldPath : patch.newPath;
    const status = patch.oldPath === "/dev/null"
      ? "create"
      : patch.newPath === "/dev/null"
        ? "delete"
        : "modify";
    const existedBefore = patch.oldPath !== "/dev/null";
    let before = null;
    let beforeHash = null;
    let beforeBytes = 0;
    let beforeMtimeMs = null;

    if (existedBefore) {
      const resolved = await resolveWorkspacePath(projectRoot, patch.oldPath, { mustExist: true });
      const stat = await fs.stat(resolved.real);
      before = stripBom(await fs.readFile(resolved.real, "utf8"));
      const hashed = hashContent(before);
      beforeHash = hashed.hash;
      beforeBytes = hashed.bytes;
      beforeMtimeMs = stat.mtimeMs;
    } else {
      const resolved = await resolveWorkspacePath(projectRoot, filePath, { mustExist: false });
      if (await fileExists(resolved.absolute)) {
        throw new Error(`create patch target already exists: ${filePath}`);
      }
    }

    snapshots.push({
      path: filePath,
      oldPath: patch.oldPath,
      newPath: patch.newPath,
      status,
      existed_before: existedBefore,
      before,
      before_hash: beforeHash,
      before_bytes: beforeBytes,
      before_mtime_ms: beforeMtimeMs
    });
  }
  return snapshots;
}

export async function restoreSnapshots(projectRoot, snapshots = []) {
  const restored = [];
  for (const snapshot of snapshots) {
    const targetPath = snapshot.newPath === "/dev/null" ? snapshot.oldPath : snapshot.newPath;
    const resolved = await resolveWorkspacePath(projectRoot, targetPath, { mustExist: false });
    if (!snapshot.existed_before) {
      await fs.rm(resolved.absolute, { force: true });
    } else {
      await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
      await fs.writeFile(resolved.absolute, snapshot.before ?? "", "utf8");
    }
    restored.push(snapshot.path);
  }
  return restored;
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

export async function applyDiffTransaction({
  projectRoot,
  parsed,
  transaction_id = makeTransactionId(),
  applyDiff = applyUnifiedDiff
} = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");
  if (!parsed?.diff || !Array.isArray(parsed.patches)) throw new Error("parsed diff is required");
  const snapshots = await snapshotTouchedFiles(projectRoot, parsed.patches);
  try {
    const applied = await applyDiff(parsed.diff, projectRoot);
    return {
      transaction_id,
      snapshots,
      applied,
      restored_on_failure: false
    };
  } catch (error) {
    const restoredFiles = await restoreSnapshots(projectRoot, snapshots);
    error.transaction_id = transaction_id;
    error.restored = true;
    error.restored_files = restoredFiles;
    error.failed_files = parsed.files || snapshots.map((item) => item.path);
    throw error;
  }
}

export function enhanceChangeRecord(record, { transaction_id = null } = {}) {
  const files = (record.files || []).map((file) => {
    const beforeMeta = file.before == null ? { hash: null, bytes: 0 } : hashContent(file.before);
    const afterMeta = file.after == null ? { hash: null, bytes: 0 } : hashContent(file.after);
    return {
      ...file,
      before_hash: file.before_hash ?? beforeMeta.hash,
      after_hash: file.after_hash ?? afterMeta.hash,
      before_bytes: file.before_bytes ?? beforeMeta.bytes,
      after_bytes: file.after_bytes ?? afterMeta.bytes,
      transaction_id: file.transaction_id || transaction_id
    };
  });
  return {
    ...record,
    transaction_id: record.transaction_id || transaction_id,
    files
  };
}

export function makeTransactionId() {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
