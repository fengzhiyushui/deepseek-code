import { test } from "node:test";
import assert from "node:assert/strict";
import { createSynthesizer } from "../../../src/core/orchestration/synthesizer.js";

const collected = [
  { st: { id: "st_1", goal: "a" }, status: "complete", wres: { content: "did a" } },
  { st: { id: "st_2", goal: "b" }, status: "failed", lastFeedback: "tests failed" }
];

test("uses model output when available", async () => {
  const s = createSynthesizer({ callModel: async () => "final summary" });
  assert.equal(await s.synthesize({ message: "x", collected }), "final summary");
});

test("falls back to a deterministic summary that names failures", async () => {
  const s = createSynthesizer({ callModel: async () => { throw new Error("model down"); } });
  const out = await s.synthesize({ message: "x", collected });
  assert.match(out, /st_1/);
  assert.match(out, /st_2/);
  assert.match(out, /fail/i);
});
