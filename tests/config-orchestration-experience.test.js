import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrchestration } from "../src/config.js";

test("crossTaskLearning defaults to off; enum normalized", () => {
  assert.equal(normalizeOrchestration({}).crossTaskLearning, "off");
  assert.equal(normalizeOrchestration({ crossTaskLearning: "on" }).crossTaskLearning, "on");
  assert.equal(normalizeOrchestration({ crossTaskLearning: "gated" }).crossTaskLearning, "gated");
  assert.equal(normalizeOrchestration({ crossTaskLearning: "bogus" }).crossTaskLearning, "off");
  assert.equal(normalizeOrchestration({ crossTaskLearning: 1 }).crossTaskLearning, "off");
});

test("experience defaults", () => {
  const e = normalizeOrchestration({}).experience;
  assert.equal(e.cap, 200);
  assert.equal(e.decayPerDay, 0.02);
  assert.deepEqual(e.thresholds, { T1: 0.7, T2: 0.4, T3: 0.2 });
  assert.equal(e.dedupThreshold, 0.6);
  assert.equal(e.maxLessonsPerTask, 5);
  assert.equal(e.retrieveK, 5);
  assert.equal(e.pendingTtlMs, 86400000);
});

test("experience invalid values fall back", () => {
  assert.equal(normalizeOrchestration({ experience: { cap: 0 } }).experience.cap, 200);
  assert.equal(normalizeOrchestration({ experience: { retrieveK: -1 } }).experience.retrieveK, 5);
  assert.equal(normalizeOrchestration({ experience: { decayPerDay: -1 } }).experience.decayPerDay, 0.02);
  assert.equal(normalizeOrchestration({ experience: { dedupThreshold: 9 } }).experience.dedupThreshold, 0.6);
  const th = normalizeOrchestration({ experience: { thresholds: { T1: 9, T2: 0.4, T3: 0.2 } } }).experience.thresholds;
  assert.equal(th.T1, 0.7); // out of [0,1] -> default
});

test("experience valid overrides pass through", () => {
  const e = normalizeOrchestration({ experience: { cap: 50, retrieveK: 3, decayPerDay: 0.05, thresholds: { T1: 0.8, T2: 0.5, T3: 0.3 } } }).experience;
  assert.equal(e.cap, 50);
  assert.equal(e.retrieveK, 3);
  assert.equal(e.decayPerDay, 0.05);
  assert.deepEqual(e.thresholds, { T1: 0.8, T2: 0.5, T3: 0.3 });
});

test("existing orchestration fields unchanged", () => {
  const o = normalizeOrchestration({});
  assert.equal(o.maxRounds, 2);
  assert.equal(o.maxSubtasks, 8);
  assert.ok(o.router);
  assert.ok(o.parallel);
});
