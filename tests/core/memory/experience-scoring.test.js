import { test } from "node:test";
import assert from "node:assert/strict";
import { score, tierOf, reinforce, weaken, daysSince } from "../../../src/core/memory/experience-scoring.js";

const T = { T1: 0.7, T2: 0.4, T3: 0.2 };
const base = { confidence: 0.5, validations: 0, misleads: 0, lastReinforced: "2026-01-01T00:00:00Z" };
const now0 = () => new Date("2026-01-01T00:00:00Z").getTime();
const later = () => new Date("2026-02-01T00:00:00Z").getTime(); // +31d

test("validations raise score, misleads lower it", () => {
  assert.ok(score({ ...base, validations: 5 }, now0) > score(base, now0));
  assert.ok(score({ ...base, misleads: 2 }, now0) < score(base, now0));
});

test("aging decays score over time (decayPerDay default 0.02)", () => {
  assert.ok(score(base, later) < score(base, now0));
});

test("score is clamped to [0,1]", () => {
  assert.equal(score({ confidence: 1, validations: 50, misleads: 0, lastReinforced: "2026-01-01T00:00:00Z" }, now0), 1);
  assert.equal(score({ confidence: 0, validations: 0, misleads: 10, lastReinforced: "2026-01-01T00:00:00Z" }, now0), 0);
});

test("decayPerDay is configurable", () => {
  const fast = score(base, later, { decayPerDay: 0.05 });
  const slow = score(base, later, { decayPerDay: 0.001 });
  assert.ok(fast < slow);
});

test("tierOf boundaries: T1/T2/T3 and evict(0)", () => {
  assert.equal(tierOf(0.75, T), 1);
  assert.equal(tierOf(0.7, T), 1);
  assert.equal(tierOf(0.5, T), 2);
  assert.equal(tierOf(0.4, T), 2);
  assert.equal(tierOf(0.25, T), 3);
  assert.equal(tierOf(0.2, T), 3);
  assert.equal(tierOf(0.1, T), 0); // below T3 => evict
});

test("reinforce bumps validations + lastReinforced; weaken bumps misleads", () => {
  const r = reinforce({ ...base, validations: 1 }, now0);
  assert.equal(r.validations, 2);
  assert.equal(r.lastReinforced, "2026-01-01T00:00:00.000Z");
  assert.equal(weaken({ ...base, misleads: 0 }).misleads, 1);
});

test("daysSince computes whole-day delta", () => {
  assert.equal(daysSince("2026-01-01T00:00:00Z", later), 31);
});
