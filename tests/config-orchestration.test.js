import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrchestration, DEFAULT_CONFIG } from "../src/config.js";

test("defaults: no enabled flag; safe gates", () => {
  const o = DEFAULT_CONFIG.orchestration;
  assert.equal("enabled" in o, false);
  assert.equal(o.maxSubtasks, 8);
  assert.equal(o.maxWorkerAttempts, 2);
  assert.equal(o.router.minComplexFiles, 2);
  assert.equal(o.budget.maxModelCalls, 40);
});

test("normalizeOrchestration deep-merges per field, clamps to safe", () => {
  const o = normalizeOrchestration({ maxSubtasks: 3, router: { minComplexFiles: 5 }, budget: { maxModelCalls: 100 } });
  assert.equal(o.maxSubtasks, 3);
  assert.equal(o.router.minComplexFiles, 5);
  assert.equal(o.budget.maxModelCalls, 100);
  assert.equal(o.maxWorkerAttempts, 2);            // untouched default
  assert.ok(Array.isArray(o.router.markers));      // default markers preserved
});

test("invalid values fall back to defaults", () => {
  const o = normalizeOrchestration({ maxSubtasks: -1, maxWorkerAttempts: 0 });
  assert.equal(o.maxSubtasks, 8);
  assert.equal(o.maxWorkerAttempts, 2);
});
