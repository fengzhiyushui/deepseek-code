import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrchestration, DEFAULT_CONFIG } from "../src/config.js";

test("maxRounds default 2", () => {
  assert.equal(DEFAULT_CONFIG.orchestration.maxRounds, 2);
});

test("normalize maxRounds posInt with fallback", () => {
  assert.equal(normalizeOrchestration({ maxRounds: 5 }).maxRounds, 5);
  assert.equal(normalizeOrchestration({ maxRounds: 0 }).maxRounds, 2);   // invalid -> default
  assert.equal(normalizeOrchestration({ maxRounds: 1 }).maxRounds, 1);
});

test("maxRounds coexists with other orchestration fields", () => {
  const o = normalizeOrchestration({ maxSubtasks: 3 });
  assert.equal(o.maxRounds, 2);
  assert.equal(o.maxSubtasks, 3);
  assert.equal(o.parallel.maxParallelWorkers, 4);
});
