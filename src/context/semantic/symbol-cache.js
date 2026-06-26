import { promises as fs } from "node:fs";
import path from "node:path";

function sanitize(file) { return file.replace(/[\\/]/g, "__"); }

export function createSymbolCache({ cacheRoot } = {}) {
  if (!cacheRoot) throw new Error("cacheRoot is required");
  const dir = path.join(cacheRoot, "symbols");

  async function get(file, hash) {
    try {
      const raw = await fs.readFile(path.join(dir, `${sanitize(file)}.json`), "utf8");
      const parsed = JSON.parse(raw);
      return parsed.hash === hash ? parsed.parseResult : null;
    } catch { return null; }
  }
  async function set(file, hash, parseResult) {
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${sanitize(file)}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ hash, parseResult }, null, 2)}\n`, "utf8");
    await fs.rename(tmp, target);
  }
  async function pruneMissing(files) {
    const keep = new Set(files.map((f) => `${sanitize(f)}.json`));
    let removed = 0;
    try {
      for (const name of await fs.readdir(dir)) {
        if (!keep.has(name)) { await fs.rm(path.join(dir, name)).catch(() => {}); removed += 1; }
      }
    } catch {}
    return removed;
  }
  return { get, set, pruneMissing };
}
