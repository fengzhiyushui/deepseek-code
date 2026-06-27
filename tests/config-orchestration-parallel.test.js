import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrchestration, DEFAULT_CONFIG } from "../src/config.js";

test("parallel defaults", () => {
  const p = DEFAULT_CONFIG.orchestration.parallel;
  assert.equal(p.maxParallelWorkers, 4);
  assert.equal(p.maxCopyFiles, 5000);
  assert.equal(p.sweepTtlMs, 3600000);
});

test("normalize clamps + falls back per field", () => {
  const o = normalizeOrchestration({ parallel: { maxParallelWorkers: 2, maxCopyFiles: 0 } });
  assert.equal(o.parallel.maxParallelWorkers, 2);
  assert.equal(o.parallel.maxCopyFiles, 5000);    // 0 invalid -> default
  assert.equal(o.parallel.sweepTtlMs, 3600000);   // untouched default
});

test("parallel survives alongside other orchestration fields", () => {
  const o = normalizeOrchestration({ maxSubtasks: 3 });
  assert.equal(o.maxSubtasks, 3);
  assert.equal(o.parallel.maxParallelWorkers, 4);
});
