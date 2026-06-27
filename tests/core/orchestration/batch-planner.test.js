import { test } from "node:test";
import assert from "node:assert/strict";
import { toBatches } from "../../../src/core/orchestration/batch-planner.js";

function st(id, files, deps = []) { return { id, context_scope: files ? { files } : {}, depends_on: deps }; }

test("independent disjoint subtasks form one parallel batch", () => {
  const subs = [st("a", ["src/a.js"]), st("b", ["src/b.js"])];
  const batches = toBatches(subs, { completedIds: new Set(), maxParallelWorkers: 4 });
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map((s) => s.id).sort(), ["a", "b"]);
});

test("overlapping scopes split into separate batches", () => {
  const subs = [st("a", ["src/shared.js"]), st("b", ["src/shared.js"])];
  const batches = toBatches(subs, { completedIds: new Set(), maxParallelWorkers: 4 });
  assert.equal(batches.length, 2);
});

test("no declared scope -> own batch (not parallelized)", () => {
  const subs = [st("a", null), st("b", ["src/b.js"])];
  const batches = toBatches(subs, { completedIds: new Set(), maxParallelWorkers: 4 });
  assert.equal(batches[0].length, 1);   // a alone
});

test("dependencies gate batching", () => {
  const subs = [st("a", ["src/a.js"]), st("b", ["src/b.js"], ["a"])];
  const batches = toBatches(subs, { completedIds: new Set(), maxParallelWorkers: 4 });
  assert.deepEqual(batches.map((b) => b.map((s) => s.id)), [["a"], ["b"]]);
});

test("maxParallelWorkers=1 -> every batch size 1", () => {
  const subs = [st("a", ["src/a.js"]), st("b", ["src/b.js"])];
  const batches = toBatches(subs, { completedIds: new Set(), maxParallelWorkers: 1 });
  assert.deepEqual(batches.map((b) => b.length), [1, 1]);
});
