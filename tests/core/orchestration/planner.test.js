import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanner } from "../../../src/core/orchestration/planner.js";

const VALID = JSON.stringify({
  task_summary: "two things", done_when: "both done",
  subtasks: [
    { id: "st_1", goal: "a", acceptance: ["a ok"], context_scope: {}, tool_profile: "edit", depends_on: [] },
    { id: "st_2", goal: "b", acceptance: ["b ok"], context_scope: {}, tool_profile: "readonly", depends_on: [] }
  ]
});

test("returns a validated plan from model output", async () => {
  const planner = createPlanner({ callModel: async () => VALID });
  const plan = await planner.plan({ message: "do a and b", context: null });
  assert.equal(plan.subtasks.length, 2);
});

test("retries on malformed plan, then succeeds", async () => {
  let n = 0;
  const planner = createPlanner({ callModel: async () => (n++ === 0 ? "not json" : VALID), maxPlanRepairs: 2 });
  const plan = await planner.plan({ message: "x", context: null });
  assert.equal(plan.subtasks.length, 2);
  assert.equal(n, 2);
});

test("degrades to a single edit subtask when retries exhausted", async () => {
  const planner = createPlanner({ callModel: async () => "still not json", maxPlanRepairs: 1 });
  const plan = await planner.plan({ message: "fix the bug", context: null });
  assert.equal(plan.subtasks.length, 1);
  assert.equal(plan.subtasks[0].tool_profile, "edit");
  assert.equal(plan.subtasks[0].depends_on.length, 0);
});

test("rejects a cyclic plan and degrades", async () => {
  const CYCLE = JSON.stringify({
    task_summary: "x", done_when: "y",
    subtasks: [
      { id: "a", goal: "a", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: ["b"] },
      { id: "b", goal: "b", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: ["a"] }
    ]
  });
  const planner = createPlanner({ callModel: async () => CYCLE, maxPlanRepairs: 0 });
  const plan = await planner.plan({ message: "z", context: null });
  assert.equal(plan.subtasks.length, 1); // degraded
});
