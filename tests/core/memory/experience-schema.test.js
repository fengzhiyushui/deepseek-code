import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntry, validatePending, FILE_SCHEMA_VERSION, clamp01 } from "../../../src/core/memory/experience-schema.js";

const mkEntry = (over = {}) => ({
  id: "exp_1", kind: "procedural", lesson: "x", cues: ["a", "b"],
  provenance: { taskId: "t1" }, confidence: 0.5, validations: 0, misleads: 0,
  created: "2026-01-01T00:00:00Z", lastReinforced: "2026-01-01T00:00:00Z", tier: 3, ...over
});

test("FILE_SCHEMA_VERSION is file-level constant", () => {
  assert.equal(FILE_SCHEMA_VERSION, 1);
});

test("validateEntry accepts a well-formed entry, rejects bad kind/confidence/cues", () => {
  assert.equal(validateEntry(mkEntry()), null);
  assert.match(validateEntry(mkEntry({ kind: "wat" })), /kind/);
  assert.match(validateEntry(mkEntry({ confidence: 2 })), /confidence/);
  assert.match(validateEntry(mkEntry({ cues: [] })), /cues/);
  assert.match(validateEntry(mkEntry({ tier: 4 })), /tier/);
  assert.match(validateEntry(mkEntry({ validations: -1 })), /validations/);
});

test("validatePending requires pendingId + valid entry", () => {
  assert.equal(validatePending({ pendingId: "p1", entry: mkEntry() }), null);
  assert.match(validatePending({ entry: mkEntry() }), /pendingId/);
  assert.match(validatePending({ pendingId: "p1", entry: mkEntry({ kind: "x" }) }), /kind/);
});

test("clamp01 clamps to [0,1]", () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(0.3), 0.3);
  assert.equal(clamp01("nan"), 0);
});
