import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrchestration } from "../src/config.js";

test("router.model defaults: enabled on, act channel, 8000/1/3", () => {
  const m = normalizeOrchestration({}).router.model;
  assert.deepEqual(m, { enabled: true, channel: "act", timeoutMs: 8000, maxRepairs: 1, complexThreshold: 3 });
});

test("router.model.enabled coerced to boolean", () => {
  assert.equal(normalizeOrchestration({ router: { model: { enabled: false } } }).router.model.enabled, false);
  assert.equal(normalizeOrchestration({ router: { model: { enabled: 0 } } }).router.model.enabled, false);
  assert.equal(normalizeOrchestration({ router: { model: { enabled: "yes" } } }).router.model.enabled, true);
});

test("router.model.maxRepairs is nonNegativeInt: 0 kept, negative/invalid → 1", () => {
  assert.equal(normalizeOrchestration({ router: { model: { maxRepairs: 0 } } }).router.model.maxRepairs, 0);
  assert.equal(normalizeOrchestration({ router: { model: { maxRepairs: -2 } } }).router.model.maxRepairs, 1);
  assert.equal(normalizeOrchestration({ router: { model: { maxRepairs: "x" } } }).router.model.maxRepairs, 1);
});

test("router.model.channel: any non-empty string passes through; blank → default", () => {
  assert.equal(normalizeOrchestration({ router: { model: { channel: "think" } } }).router.model.channel, "think");
  assert.equal(normalizeOrchestration({ router: { model: { channel: "" } } }).router.model.channel, "act");
  assert.equal(normalizeOrchestration({ router: { model: { channel: 7 } } }).router.model.channel, "act");
});

test("timeoutMs/complexThreshold posInt fallback; existing router fields kept", () => {
  const r = normalizeOrchestration({ router: { minComplexFiles: 4, model: { timeoutMs: 0, complexThreshold: -1 } } }).router;
  assert.equal(r.minComplexFiles, 4);
  assert.equal(r.model.timeoutMs, 8000);
  assert.equal(r.model.complexThreshold, 3);
});
