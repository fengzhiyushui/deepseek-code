import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, normalizeLimits, DEFAULT_CONFIG } from "../../src/config.js";

test("DEFAULT_CONFIG enables 120s timeouts, leaves budgets off", () => {
  assert.equal(DEFAULT_CONFIG.limits.toolTimeoutMs, 120000);
  assert.equal(DEFAULT_CONFIG.limits.modelTimeoutMs, 120000);
  assert.equal(DEFAULT_CONFIG.limits.maxTurnTokens, null);
  assert.equal(DEFAULT_CONFIG.limits.maxModelCalls, null);
  assert.equal(DEFAULT_CONFIG.limits.maxToolCallRepairs, null);
});

test("normalizeConfig fills default limits when omitted", () => {
  const c = normalizeConfig({});
  assert.equal(c.limits.toolTimeoutMs, 120000);
  assert.equal(c.limits.modelTimeoutMs, 120000);
});

test("normalizeConfig deep-merges user limits per field", () => {
  const c = normalizeConfig({ limits: { toolTimeoutMs: 5000, maxModelCalls: 10 } });
  assert.equal(c.limits.toolTimeoutMs, 5000);     // user override
  assert.equal(c.limits.modelTimeoutMs, 120000);  // default preserved
  assert.equal(c.limits.maxModelCalls, 10);       // user opt-in
});

test("normalizeLimits treats null / <=0 as disabled", () => {
  assert.equal(normalizeLimits({ toolTimeoutMs: null }).toolTimeoutMs, null);
  assert.equal(normalizeLimits({ modelTimeoutMs: 0 }).modelTimeoutMs, null);
  assert.equal(normalizeLimits({ toolTimeoutMs: -5 }).toolTimeoutMs, null);
});

test("normalizeLimits coerces numeric strings and truncates", () => {
  assert.equal(normalizeLimits({ toolTimeoutMs: "3000" }).toolTimeoutMs, 3000);
  assert.equal(normalizeLimits({ maxModelCalls: 4.9 }).maxModelCalls, 4);
});
