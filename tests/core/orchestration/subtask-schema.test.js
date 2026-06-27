import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlan, validateVerdict, topoOrder, hasCycle } from "../../../src/core/orchestration/subtask-schema.js";

const goodPlan = {
  task_summary: "add validation to 2 modules",
  done_when: "both modules validate inputs",
  subtasks: [
    { id: "st_1", goal: "validate a", acceptance: ["a rejects empty"], context_scope: { files: ["a.js"] }, tool_profile: "edit", depends_on: [] },
    { id: "st_2", goal: "validate b", acceptance: ["b rejects empty"], context_scope: {}, tool_profile: "edit", depends_on: ["st_1"] }
  ]
};

test("validatePlan accepts a well-formed plan", () => {
  const r = validatePlan(goodPlan);
  assert.equal(r.ok, true);
  assert.equal(r.plan.subtasks.length, 2);
});

test("validatePlan rejects missing fields", () => {
  assert.equal(validatePlan({}).ok, false);
  assert.equal(validatePlan({ task_summary: "x", done_when: "y", subtasks: [{ id: "st_1" }] }).ok, false);
  assert.equal(validatePlan({ task_summary: "x", done_when: "y", subtasks: [{ id: "st_1", goal: "g", acceptance: [], context_scope: {}, tool_profile: "nope", depends_on: [] }] }).ok, false);
});

test("topoOrder sorts by depends_on; hasCycle detects loops", () => {
  const order = topoOrder(goodPlan.subtasks).map((s) => s.id);
  assert.deepEqual(order, ["st_1", "st_2"]);
  assert.equal(hasCycle(goodPlan.subtasks), false);
  const cyclic = [
    { id: "a", goal: "g", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: ["b"] },
    { id: "b", goal: "g", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: ["a"] }
  ];
  assert.equal(hasCycle(cyclic), true);
  assert.throws(() => topoOrder(cyclic), (e) => e.code === "CYCLE");
});

test("validateVerdict accepts/rejects", () => {
  assert.equal(validateVerdict({ pass: true, severity: "warn", reasons: [], checked: ["ran tests"] }).ok, true);
  assert.equal(validateVerdict({ pass: "yes" }).ok, false);
});
