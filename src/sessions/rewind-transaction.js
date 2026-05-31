import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../workspace/path-safety.js";

export async function captureRewindSnapshots(projectRoot, files = []) {
  if (!projectRoot) throw new Error("projectRoot is required");
  const uniqueFiles = [...new Set((files || []).filter(Boolean))];
  const snapshots = [];
  for (const file of uniqueFiles) {
    const resolved = await resolveWorkspacePath(projectRoot, file, { mustExist: false });
    try {
      const stat = await fs.stat(resolved.absolute);
      if (!stat.isFile()) {
        snapshots.push(emptySnapshot(file));
        continue;
      }
      const before = stripBom(await fs.readFile(resolved.absolute, "utf8"));
      const meta = hashContent(before);
      snapshots.push({
        path: file,
        existed_before: true,
        before,
        before_hash: meta.hash,
        before_bytes: meta.bytes
      });
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
      snapshots.push(emptySnapshot(file));
    }
  }
  return snapshots;
}

export async function restoreRewindSnapshots(projectRoot, snapshots = []) {
  if (!projectRoot) throw new Error("projectRoot is required");
  const restored = [];
  const createdDirs = new Set();
  for (const snapshot of snapshots) {
    const resolved = await resolveWorkspacePath(projectRoot, snapshot.path, { mustExist: false });
    if (snapshot.existed_before) {
      await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
      await fs.writeFile(resolved.absolute, snapshot.before ?? "", "utf8");
    } else {
      await fs.rm(resolved.absolute, { force: true });
      let dir = path.dirname(resolved.absolute);
      const root = path.resolve(projectRoot);
      while (dir !== root && dir.startsWith(root) && !createdDirs.has(dir)) {
        createdDirs.add(dir);
        dir = path.dirname(dir);
      }
    }
    restored.push(snapshot.path);
  }
  for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
    try {
      await fs.rmdir(dir);
    } catch {
      // Best-effort cleanup of empty directories created during failed rewind.
    }
  }
  return restored;
}

export function safeRewindError(_error, phase = "rewind") {
  if (phase === "rollback") return "rollback_failed";
  if (phase === "create_branch") return "branch_create_failed";
  if (phase === "activate_branch") return "branch_activate_failed";
  if (phase === "restore") return "restore_failed";
  return "rewind_failed";
}

export function redactRewindSnapshots(snapshots = []) {
  return snapshots.map(({ before, ...safe }) => safe);
}

function emptySnapshot(file) {
  return {
    path: file,
    existed_before: false,
    before: null,
    before_hash: null,
    before_bytes: 0
  };
}

function hashContent(content) {
  const value = String(content ?? "");
  return {
    hash: `sha256:${createHash("sha256").update(value).digest("hex")}`,
    bytes: Buffer.byteLength(value, "utf8")
  };
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}
