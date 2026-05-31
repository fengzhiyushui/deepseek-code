import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCheckpointIndex,
  computeRollbackPlan,
  resolveRewindTarget
} from "../../../src/sessions/checkpoint-index.js";

const EVENTS = [
  { seq: 1, event_id: "evt_start", type: "session:start", branch_id: "br_main" },
  { seq: 2, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
  { seq: 3, event_id: "evt_final_1", type: "agent:final", turn_id: "turn_1", branch_id: "br_main" },
  { seq: 4, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" },
  { seq: 5, event_id: "evt_user_2", type: "user:message", turn_id: "turn_2", branch_id: "br_main" },
  { seq: 6, event_id: "evt_apply_2", type: "file:transaction_committed", change_id: "change_2", files: ["b.txt"], branch_id: "br_main" },
  { seq: 7, event_id: "evt_final_2", type: "agent:final", turn_id: "turn_2", branch_id: "br_main" }
];

test("buildCheckpointIndex derives turn checkpoints with cumulative changes", () => {
  const index = buildCheckpointIndex(EVENTS, { branch_id: "br_main" });

  assert.equal(index.checkpoints.length >= 2, true);
  const turn2 = [...index.checkpoints].reverse().find((checkpoint) => checkpoint.turn_id === "turn_2");
  assert.equal(turn2.seq, 7);
  assert.deepEqual(turn2.cumulative_change_ids, ["change_1", "change_2"]);
});

test("resolveRewindTarget finds target by turn id event id or seq", () => {
  const index = buildCheckpointIndex(EVENTS, { branch_id: "br_main" });

  assert.equal(resolveRewindTarget(index, { turn_id: "turn_1" }).turn_id, "turn_1");
  assert.equal(resolveRewindTarget(index, { event_id: "evt_apply_1" }).event_id, "evt_apply_1");
  assert.equal(resolveRewindTarget(index, { seq: 3 }).seq, 3);
});

test("computeRollbackPlan returns changes after target in reverse order", () => {
  const index = buildCheckpointIndex(EVENTS, { branch_id: "br_main" });
  const target = resolveRewindTarget(index, { turn_id: "turn_1" });

  const plan = computeRollbackPlan(index, target);

  assert.deepEqual(plan.change_ids, ["change_2", "change_1"]);
  assert.deepEqual(plan.files.sort(), ["a.txt", "b.txt"]);
});

test("checkpoint index treats branchless events as br_main", () => {
  const index = buildCheckpointIndex(EVENTS.map(({ branch_id, ...event }) => event), { branch_id: "br_main" });

  assert.equal(index.events.every((event) => event.branch_id === "br_main"), true);
});
