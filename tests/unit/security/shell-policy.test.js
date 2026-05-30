import test from "node:test";
import assert from "node:assert/strict";
import { normalizeShellParams, limitOutput } from "../../../src/security/shell-policy.js";

test("normalizeShellParams rejects raw command strings", () => {
  assert.throws(
    () => normalizeShellParams({ cmd: "npm test" }),
    /structured argv/
  );
});

test("normalizeShellParams accepts structured argv and sets shell false", () => {
  const params = normalizeShellParams({ argv: ["node", "--version"], cwd: "src" });
  assert.deepEqual(params.argv, ["node", "--version"]);
  assert.equal(params.cwd, "src");
  assert.equal(params.shell, false);
});

test("normalizeShellParams rejects empty or non-string argv", () => {
  assert.throws(() => normalizeShellParams({ argv: [] }), /argv must contain/);
  assert.throws(() => normalizeShellParams({ argv: ["node", 3] }), /argv entries/);
});

test("limitOutput truncates long process output", () => {
  const output = limitOutput("x".repeat(20), 8);
  assert.equal(output.truncated, true);
  assert.equal(output.text, "xxxxxxxx");
  assert.equal(output.original_length, 20);
});
