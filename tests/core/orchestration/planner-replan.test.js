import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanner } from "../../../src/core/orchestration/planner.js";

const VALID = JSON.stringify({ done: false, subtasks: [
  { id: "r1", goal: "fix a", acceptance: ["a fixed"], context_scope: { files: ["a.js"] }, tool_profile: "edit", depends_on: [] }
] });
const ctx = { seenSubtaskIds: new Set(["st_1"]), completedIds: new Set(["st_1"]), failedIds: new Set() };

test("replan returns {done, subtasks} from model", async () => {
  const planner = createPlanner({ callModel: async () => VALID });
  const r = await planner.replan({ message: "m", done_when: "d", completed: [{ id: "st_1", goal: "x" }], failed: [], ...ctx });
  assert.equal(r.done, false);
  assert.equal(r.subtasks.length, 1);
});

test("replan done:true short-circuits", async () => {
  const planner = createPlanner({ callModel: async () => '{"done":true,"subtasks":[]}' });
  const r = await planner.replan({ message: "m", done_when: "d", completed: [], failed: [], ...ctx });
  assert.equal(r.done, true);
  assert.deepEqual(r.subtasks, []);
});

test("malformed -> conservative done:true after retries", async () => {
  const planner = createPlanner({ callModel: async () => "not json", maxPlanRepairs: 1 });
  const r = await planner.replan({ message: "m", done_when: "d", completed: [], failed: [], ...ctx });
  assert.equal(r.done, true);
  assert.deepEqual(r.subtasks, []);
});

test("invalid subtasks (id collision) -> conservative done", async () => {
  const COLLIDE = JSON.stringify({ done: false, subtasks: [{ id: "st_1", goal: "g", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }] });
  const planner = createPlanner({ callModel: async () => COLLIDE, maxPlanRepairs: 0 });
  const r = await planner.replan({ message: "m", done_when: "d", completed: [], failed: [], ...ctx });
  assert.equal(r.done, true);
});

test("plan still works (createPlanner returns both)", async () => {
  const planner = createPlanner({ callModel: async () => '{"task_summary":"t","done_when":"d","subtasks":[{"id":"st_1","goal":"g","acceptance":[],"context_scope":{},"tool_profile":"edit","depends_on":[]}]}' });
  assert.equal(typeof planner.plan, "function");
  assert.equal(typeof planner.replan, "function");
  const p = await planner.plan({ message: "m", context: null });
  assert.equal(p.subtasks.length, 1);
});
