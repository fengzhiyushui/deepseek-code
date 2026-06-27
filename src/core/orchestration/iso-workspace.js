import { promises as fs } from "node:fs";
import path from "node:path";

function isoBase(root) { return path.join(root, ".deepseek-code", "v2", "orchestration", "iso"); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createIso({ root, runId, subtaskId }) {
  const runDir = path.join(isoBase(root), runId);
  const iso = path.join(runDir, subtaskId);
  await fs.mkdir(iso, { recursive: true });
  const owner = path.join(runDir, ".owner");
  try { await fs.writeFile(owner, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: "wx" }); }
  catch { /* sibling subtask of this run already wrote it */ }
  return iso;
}

export async function removeIso(isoRoot, { retries = 3, backoffMs = 50 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { await fs.rm(isoRoot, { recursive: true, force: true }); return true; }
    catch {
      if (attempt === retries) return false;            // give up; caller logs warning
      await sleep(backoffMs * Math.pow(3, attempt));    // 50 / 150 / 450ms
    }
  }
  return false;
}

export async function sweepOrphans({ root, ttlMs = 3600000, pid = process.pid }) {
  const base = isoBase(root);
  let runs;
  try { runs = await fs.readdir(base, { withFileTypes: true }); }
  catch { return []; }
  const removed = [];
  for (const e of runs) {
    if (!e.isDirectory()) continue;
    const runDir = path.join(base, e.name);
    let owner = null;
    try { owner = JSON.parse(await fs.readFile(path.join(runDir, ".owner"), "utf8")); } catch { /* missing/corrupt */ }
    const stale = !owner || (Date.now() - (owner.ts || 0)) > ttlMs;
    const ours = owner && owner.pid === pid;
    // remove only stale runs OR our own prior runs — never another live process's fresh run
    if (stale || ours) {
      await fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
      removed.push(runDir);
    }
  }
  return removed;
}
