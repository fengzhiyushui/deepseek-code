import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createShellTool } from "../../../src/tools/builtin/shell.js";
import { createTestTool } from "../../../src/tools/builtin/test.js";
import { createGitTool } from "../../../src/tools/builtin/git.js";

test("shell tool executes structured argv with shell false", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-shell-"));
  const result = await createShellTool().execute(
    { argv: [process.execPath, "-e", "console.log('ok')"], cwd: "." },
    { projectRoot: root }
  );

  assert.equal(result.metadata.exit_code, 0);
  assert.equal(result.stdout.trim(), "ok");
});

test("shell tool rejects raw cmd strings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-shell-"));

  await assert.rejects(
    () => createShellTool().execute({ cmd: "echo nope" }, { projectRoot: root }),
    /structured argv/
  );
});

test("test tool detects npm test from package json", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dsc-test-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --version" } }));

  const result = await createTestTool().execute({ detect: true }, { projectRoot: root });

  assert.deepEqual(result.metadata.argv, ["npm", "test"]);
});

test("git tool only allows read operations", async () => {
  const tool = createGitTool();
  assert.throws(() => tool.normalizeParams({ op: "commit" }), /unsupported git read op/);
  assert.deepEqual(tool.normalizeParams({ op: "status" }).argv, ["git", "status", "--short"]);
});
