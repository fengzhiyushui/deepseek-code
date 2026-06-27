import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const EXCLUDE = new Set([".git", "node_modules", ".deepseek-code"]);

function toPosix(p) { return p.replace(/\\/g, "/"); }

async function* walk(root, rel = "") {
  const dir = rel ? path.join(root, rel) : root;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (EXCLUDE.has(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walk(root, childRel);
    else if (e.isFile()) yield toPosix(childRel);
  }
}

export async function fsCopyWorkspace(srcRoot, destRoot, { maxCopyFiles = 5000 } = {}) {
  let copied = 0, truncated = false;
  for await (const rel of walk(srcRoot)) {
    if (copied >= maxCopyFiles) { truncated = true; break; }
    const from = path.join(srcRoot, rel), to = path.join(destRoot, rel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    copied += 1;
  }
  return { copied, truncated };
}

export async function hashTree(root, { maxCopyFiles = 5000 } = {}) {
  const manifest = new Map();
  let n = 0;
  for await (const rel of walk(root)) {
    if (n >= maxCopyFiles) break;
    const buf = await fs.readFile(path.join(root, rel));
    manifest.set(rel, `sha256:${createHash("sha256").update(buf).digest("hex")}`);
    n += 1;
  }
  return manifest;
}

export function changedPaths(currentManifest, baseManifest) {
  const added = [], deleted = [], modified = [];
  for (const [p, h] of currentManifest) {
    if (!baseManifest.has(p)) added.push(p);
    else if (baseManifest.get(p) !== h) modified.push(p);
  }
  for (const p of baseManifest.keys()) if (!currentManifest.has(p)) deleted.push(p);
  added.sort(); deleted.sort(); modified.sort();
  return { added, deleted, modified };
}
