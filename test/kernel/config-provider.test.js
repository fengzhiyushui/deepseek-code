// test/kernel/config-provider.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, DEFAULT_MODEL_PROFILES } from "../../src/kernel/config-provider.js";

const tmpDir = path.join(os.tmpdir(), `dsc-config-test-${Date.now()}`);
const localConfigDir = path.join(tmpDir, ".deepseek-code");

test.before(async () => {
  await fs.mkdir(localConfigDir, { recursive: true });
});

test.after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("loads defaults when no config files exist and no env vars", async () => {
  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.equal(config.model, "deepseek-v4-flash");
  assert.equal(config.apiKey, "");
  assert.equal(config.thinking.type, "disabled");
  assert.equal(config.reasoningEffort, "high");
});

test("merges project-local config over defaults", async () => {
  await fs.writeFile(
    path.join(localConfigDir, "config.json"),
    JSON.stringify({ model: "custom-model", temperature: 0.5 })
  );

  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  assert.equal(config.model, "custom-model");
  assert.equal(config.temperature, 0.5);
  assert.equal(config.baseUrl, "https://api.deepseek.com");
});

test("env vars override file config", async () => {
  process.env.DEEPSEEK_MODEL = "env-model";
  process.env.DEEPSEEK_API_KEY = "env-key-123";

  await fs.writeFile(
    path.join(localConfigDir, "config.json"),
    JSON.stringify({ model: "file-model", apiKey: "file-key" })
  );

  try {
    const config = await loadConfig(tmpDir);
    assert.equal(config.model, "env-model");
    assert.equal(config.apiKey, "env-key-123");
  } finally {
    delete process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_API_KEY;
  }
});

test("throws when apiKey is missing and allowMissingKey is not set", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  // Remove any project-local config that may have an apiKey from earlier tests
  const cfgPath = path.join(localConfigDir, "config.json");
  try { await fs.unlink(cfgPath); } catch (_) { /* ok */ }
  try {
    await assert.rejects(
      () => loadConfig(tmpDir),
      /缺少 DeepSeek API 密钥/
    );
  } finally {
    // cleanup
  }
});

test("returns config without apiKey when allowMissingKey is set", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  // Remove any project-local config that may have an apiKey from earlier tests
  const cfgPath = path.join(localConfigDir, "config.json");
  try { await fs.unlink(cfgPath); } catch (_) { /* ok */ }
  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  assert.equal(config.apiKey, "");
});

test("ModelProfiles are included in config", async () => {
  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  assert.ok(typeof config.profiles === "object");
  assert.ok(config.profiles.reasoning);
  assert.ok(config.profiles.fast);
  assert.ok(config.profiles.fim);
  assert.ok(Array.isArray(config.profiles.reasoning.models));
  assert.ok(Array.isArray(config.profiles.fast.models));
});

test("profile resolve picks first available model", async () => {
  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  const resolved = config.profiles.reasoning.resolve();
  assert.equal(typeof resolved, "string");
  assert.ok(resolved.length > 0);
});

test("thinking=disabled is explicit in config, not undefined", async () => {
  await fs.writeFile(
    path.join(localConfigDir, "config.json"),
    JSON.stringify({ thinking: { type: "disabled" } })
  );
  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  assert.equal(config.thinking.type, "disabled");
});

test("thinking=enabled is normalized correctly", async () => {
  await fs.writeFile(
    path.join(localConfigDir, "config.json"),
    JSON.stringify({ thinking: { type: "enabled" }, reasoningEffort: "max" })
  );
  const config = await loadConfig(tmpDir, { allowMissingKey: true });
  assert.equal(config.thinking.type, "enabled");
  assert.equal(config.reasoningEffort, "max");
});
