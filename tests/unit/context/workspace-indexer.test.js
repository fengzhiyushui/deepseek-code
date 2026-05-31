import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { indexWorkspace, shouldSkipContextPath } from "../../../src/context/workspace-indexer.js";

test("indexWorkspace indexes safe text files with context units", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-index-"));
  await writeFile(path.join(root, "package.json"), "{\"name\":\"demo\"}\n");
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.js"), "export const demo = true;\n");

  const result = await indexWorkspace({ root });

  assert.ok(result.units.has("package.json"));
  assert.ok(result.units.has("src/index.js"));
  assert.equal(result.stats.indexed_files, 2);
  assert.equal(result.stats.skipped_files, 0);
});

test("indexWorkspace skips ignored directories and secret-like files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-skip-"));
  await writeFile(path.join(root, "README.md"), "# demo\n");
  await writeFile(path.join(root, ".env"), "DEEPSEEK_API_KEY=secret\n");
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "pkg.js"), "module.exports = 1;\n");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "bundle.js"), "generated\n");

  const result = await indexWorkspace({ root });

  assert.ok(result.units.has("README.md"));
  assert.equal(result.units.has(".env"), false);
  assert.equal(result.units.has("node_modules/pkg.js"), false);
  assert.equal(result.units.has("dist/bundle.js"), false);
  assert.equal(result.stats.indexed_files, 1);
  assert.ok(result.stats.skipped_files >= 1);
});

test("indexWorkspace skips binary and oversized files without failing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-context-binary-"));
  await writeFile(path.join(root, "README.md"), "# demo\n");
  await writeFile(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(path.join(root, "large.txt"), "x".repeat(128));

  const result = await indexWorkspace({
    root,
    options: { maxFileBytes: 32, maxSnippetBytes: 16 }
  });

  assert.ok(result.units.has("README.md"));
  assert.equal(result.units.has("image.bin"), false);
  assert.equal(result.units.has("large.txt"), false);
  assert.ok(result.stats.skipped_files >= 2);
});

test("shouldSkipContextPath blocks generated and secret names", () => {
  assert.equal(shouldSkipContextPath("node_modules/pkg/index.js"), true);
  assert.equal(shouldSkipContextPath("gui/node_modules/electron/index.js"), true);
  assert.equal(shouldSkipContextPath(".deepseek-code/v2/session.jsonl"), true);
  assert.equal(shouldSkipContextPath(".env.local"), true);
  assert.equal(shouldSkipContextPath("certs/server.key"), true);
  assert.equal(shouldSkipContextPath("src/index.js"), false);
});
