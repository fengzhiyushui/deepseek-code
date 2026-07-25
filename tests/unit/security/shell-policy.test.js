import test from "node:test";
import assert from "node:assert/strict";
import { normalizeShellParams, limitOutput, buildChildEnv, runProcess } from "../../../src/security/shell-policy.js";

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

test("buildChildEnv keeps whitelist keys and drops secrets/proxies/others", () => {
  const baseEnv = {
    PATH: "/usr/bin",
    DEEPSEEK_API_KEY: "sk-secret",
    OPENAI_API_KEY: "sk-other",
    HTTP_PROXY: "http://proxy:8080",
    http_proxy: "http://proxy:8080",
    NODE_OPTIONS: "--max-old-space-size=4096",
    FOO: "bar"
  };
  const env = buildChildEnv(baseEnv);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal("DEEPSEEK_API_KEY" in env, false);
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("HTTP_PROXY" in env, false);
  assert.equal("http_proxy" in env, false);
  assert.equal("NODE_OPTIONS" in env, false);
  assert.equal("FOO" in env, false);
});

test("buildChildEnv allowExtra copies exact keys present in baseEnv", () => {
  const env = buildChildEnv({ FOO: "bar", PATH: "/bin" }, { allowExtra: ["FOO"] });
  assert.equal(env.FOO, "bar");
  assert.equal(env.PATH, "/bin");
});

test("buildChildEnv preserves actual key casing for whitelist matches", () => {
  const env = buildChildEnv({ Path: "C:\\Windows" });
  assert.equal(env.Path, "C:\\Windows");
  assert.equal("PATH" in env, false);
});

test("runProcess does not leak secrets to child processes", async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-should-not-leak";
  try {
    const result = await runProcess(
      [process.execPath, "-e", "process.stdout.write(process.env.DEEPSEEK_API_KEY || '')"],
      { cwd: process.cwd(), timeoutMs: 10000 }
    );
    assert.equal(result.metadata.exit_code, 0);
    assert.equal(result.stdout, "");
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previous;
    }
  }
});
