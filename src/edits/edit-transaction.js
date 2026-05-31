import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace/path-safety.js";

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

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
