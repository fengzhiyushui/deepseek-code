import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hydrateContextRecords,
  scanContextWithCache
} from "../../../src/context/context-cache.js";

test("scanContextWithCache saves metadata-only manifest and reuses unchanged files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-cache-"));
  const cacheRoot = path.join(root, ".cache");
  await writeFile(path.join(root, "README.md"), "# demo\n");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.js"), "export const demo = true;\n");

  const first = await scanContextWithCache({ root, options: { cacheRoot } });
  const second = await scanContextWithCache({ root, options: { cacheRoot } });
  const raw = await readFile(path.join(cacheRoot, "manifest.json"), "utf8");

  assert.equal(first.stats.changed_files, 2);
  assert.equal(first.stats.reused_files, 0);
  assert.equal(second.stats.changed_files, 0);
  assert.equal(second.stats.reused_files, 2);
  assert.equal(raw.includes("export const demo"), false);
  assert.equal(raw.includes("snippet"), false);
});

test("scanContextWithCache re-reads modified files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-cache-change-"));
  const cacheRoot = path.join(root, ".cache");
  await writeFile(path.join(root, "README.md"), "# demo\n");
  const first = await scanContextWithCache({ root, options: { cacheRoot } });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await writeFile(path.join(root, "README.md"), "# changed\n");
  const second = await scanContextWithCache({ root, options: { cacheRoot } });

  assert.notEqual(second.records.get("README.md").hash, first.records.get("README.md").hash);
  assert.equal(second.stats.changed_files, 1);
});

test("scanContextWithCache does not persist hidden config or credential files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-cache-secret-"));
  const cacheRoot = path.join(root, ".cache");
  await writeFile(path.join(root, "README.md"), "# demo\n");
  await mkdir(path.join(root, ".claude"), { recursive: true });
  await writeFile(path.join(root, ".claude", "settings.local.json"), "{\"allow\":[\"secret\"]}");
  await writeFile(path.join(root, ".npmrc"), "//registry/:_authToken=secret\n");

  const result = await scanContextWithCache({ root, options: { cacheRoot } });
  const raw = await readFile(path.join(cacheRoot, "manifest.json"), "utf8");

  assert.ok(result.records.has("README.md"));
  assert.equal(result.records.has(".claude/settings.local.json"), false);
  assert.equal(result.records.has(".npmrc"), false);
  assert.equal(raw.includes("_authToken"), false);
});

test("hydrateContextRecords reads snippets lazily and skips unreadable selected files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-hydrate-"));
  await writeFile(path.join(root, "README.md"), "# demo\n");
  const scanned = await scanContextWithCache({ root, options: { persistent: false } });
  const missing = { ...scanned.records.get("README.md"), path: "missing.md" };

  const result = await hydrateContextRecords({
    root,
    records: [scanned.records.get("README.md"), missing],
    options: { maxFileBytes: 1024, maxSnippetBytes: 10 }
  });

  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].path, "README.md");
  assert.equal(result.units[0].snippet, "# demo\n");
  assert.equal(result.stats.hydrate_skipped_files, 1);
});
