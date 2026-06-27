import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerFactory } from "../../../src/core/orchestration/worker-factory.js";

const ALL = ["read", "test", "edit", "git", "diff_apply"].map((name) => ({ type: "function", function: { name } }));

function makeFactory() {
  const created = [];
  const createRuntime = (overrides) => { created.push(overrides); return { id: created.length, overrides }; };
  const factory = createWorkerFactory({
    createRuntime,
    baseToolSchemas: () => ALL,
    makeContextSnapshot: async (input) => ({ scope: input.scope })
  });
  return { factory, created };
}

test("worker gets edit profile schemas + scoped snapshot", async () => {
  const { factory } = makeFactory();
  const st = { id: "st_1", tool_profile: "edit", context_scope: { files: ["a.js"] } };
  const w = factory.worker(st);
  const names = w.overrides.toolSchemas().map((s) => s.function.name);
  assert.ok(names.includes("edit") && names.includes("read"));
  const snap = await w.overrides.createContextSnapshot({ message: "x" });
  assert.deepEqual(snap.scope, { files: ["a.js"] });
});

test("reviewerRuntime gets readonly schemas (no edit/git)", () => {
  const { factory } = makeFactory();
  const r = factory.reviewerRuntime();
  const names = r.overrides.toolSchemas().map((s) => s.function.name);
  assert.equal(names.includes("edit"), false);
  assert.equal(names.includes("git"), false);
  assert.ok(names.includes("read") && names.includes("test"));
});
