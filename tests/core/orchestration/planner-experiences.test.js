import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlanner } from "../../../src/core/orchestration/planner.js";

const validPlanJson = (extra = "") => JSON.stringify({
  task_summary: "s", done_when: "d",
  subtasks: [{ id: "st1", goal: "g", acceptance: ["a"], context_scope: { files: [] }, tool_profile: "edit", depends_on: [] }],
  ...(extra ? JSON.parse(extra) : {})
});

test("experiences are injected into the planner prompt; used_experience_ids parsed", async () => {
  let seen = "";
  const callModel = async (p) => { seen = p; return validPlanJson('{"used_experience_ids":["exp_1"]}'); };
  const planner = createPlanner({ callModel });
  const plan = await planner.plan({ message: "x", experiences: [{ id: "exp_1", lesson: "prefer X over Y", tier: 1 }] });
  assert.match(seen, /prefer X over Y/);
  assert.match(seen, /used_experience_ids/);
  assert.deepEqual(plan.used_experience_ids, ["exp_1"]);
});

test("no experiences → no experience section, used_experience_ids defaults to []", async () => {
  let seen = "";
  const callModel = async (p) => { seen = p; return validPlanJson(); };
  const planner = createPlanner({ callModel });
  const plan = await planner.plan({ message: "x" });
  assert.ok(!/past experience/i.test(seen));
  assert.ok(!/used_experience_ids/.test(seen));
  assert.deepEqual(plan.used_experience_ids, []);
});

test("malformed used_experience_ids ignored (defaults to [])", async () => {
  const callModel = async () => validPlanJson('{"used_experience_ids":"nope"}');
  const planner = createPlanner({ callModel });
  const plan = await planner.plan({ message: "x", experiences: [{ id: "exp_1", lesson: "L", tier: 2 }] });
  assert.deepEqual(plan.used_experience_ids, []);
});
