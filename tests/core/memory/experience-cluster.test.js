import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCues, jaccard, cluster, effectiveCues } from "../../../src/core/memory/experience-cluster.js";

test("normalizeCues: lowercase, dedupe, sort, drop stopwords/low-info", () => {
  assert.deepEqual(normalizeCues(["Test", "Auth", "auth", "the"]), ["auth"]);
  assert.deepEqual(normalizeCues(["zebra", "apple"]), ["apple", "zebra"]); // sorted
});

test("code path/command kept as a single cue (not split, not dropped)", () => {
  assert.ok(normalizeCues(["src/index.js"]).includes("src/index.js"));
  assert.ok(normalizeCues(["npm run build"]).length >= 1);
});

test("jaccard symmetric + bounds", () => {
  assert.equal(jaccard(["a", "b"], ["a", "b"]), 1);
  assert.equal(jaccard(["a"], ["b"]), 0);
  assert.equal(jaccard(["a", "b", "c"], ["b", "c"]), jaccard(["b", "c"], ["a", "b", "c"]));
  assert.equal(jaccard([], []), 0);
});

test("effectiveCues guard: low-info excluded, <2 effective => not clusterable", () => {
  assert.deepEqual(effectiveCues(["auth", "login"]).sort(), ["auth", "login"]);
  assert.equal(effectiveCues(["test"]).length, 0);
  assert.equal(effectiveCues(["file", "error"]).length, 0);
});

test("cluster never merges across kind, keeps highest tier, sums validations", () => {
  const A = { id: "a", kind: "procedural", lesson: "LA", cues: ["auth", "login"], tier: 3, validations: 1, provenance: { taskId: "tA" } };
  const B = { id: "b", kind: "procedural", lesson: "LB", cues: ["auth", "login", "session"], tier: 1, validations: 2, provenance: { taskId: "tB" } };
  const R = { id: "r", kind: "risk", lesson: "LR", cues: ["auth", "login"], tier: 2, validations: 0, provenance: { taskId: "tR" } };
  const out = cluster([A, B, R], { dedupThreshold: 0.6 });
  const proc = out.filter((e) => e.kind === "procedural");
  assert.equal(proc.length, 1);
  assert.equal(proc[0].tier, 1);          // highest tier (B) survives
  assert.equal(proc[0].lesson, "LB");
  assert.equal(proc[0].validations, 3);   // 1 + 2
  assert.ok(proc[0].cues.includes("session")); // union
  assert.equal(out.filter((e) => e.kind === "risk").length, 1); // risk never merged into procedural
});

test("cluster leaves low-effective-cue entries as singletons", () => {
  const X = { id: "x", kind: "procedural", lesson: "LX", cues: ["test"], tier: 3, validations: 0, provenance: {} };
  const Y = { id: "y", kind: "procedural", lesson: "LY", cues: ["test"], tier: 3, validations: 0, provenance: {} };
  const out = cluster([X, Y], { dedupThreshold: 0.6 });
  assert.equal(out.length, 2); // not merged (each <2 effective cues)
});
