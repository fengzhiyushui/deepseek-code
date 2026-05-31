import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createRewindService } from "../../../src/sessions/rewind-service.js";

test("rewind preview computes reverse rollback plan without writing", async () => {
  const eventBus = createEventBus();
  const events = [];
  eventBus.subscribe("session:rewind_preview", (data) => events.push(data));
  const rollbacks = [];
  const service = createRewindService({
    eventBus,
    getTimeline: async () => [
      { seq: 1, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
      { seq: 2, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" },
      { seq: 3, event_id: "evt_user_2", type: "user:message", turn_id: "turn_2", branch_id: "br_main" },
      { seq: 4, event_id: "evt_apply_2", type: "file:diff_applied", change_id: "change_2", files: ["b.txt"], branch_id: "br_main" }
    ],
    getActiveBranchId: async () => "br_main",
    rollback: async (input) => rollbacks.push(input)
  });

  const result = await service.preview({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "success");
  assert.deepEqual(result.rollback_change_ids, ["change_2", "change_1"]);
  assert.deepEqual(rollbacks, []);
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events).includes("diff --git"), false);
});

test("rewind preview throws when missing required dependencies", async () => {
  assert.throws(() => createRewindService(), /getTimeline is required/);
  assert.throws(() => createRewindService({ getTimeline: async () => [] }), /getActiveBranchId is required/);
  assert.throws(
    () => createRewindService({ getTimeline: async () => [], getActiveBranchId: async () => "br_main" }),
    /rollback is required/
  );
});

test("rewind apply rolls back changes creates and activates child branch", async () => {
  const eventBus = createEventBus();
  const published = [];
  for (const type of ["session:rewind_started", "session:branch_created", "session:branch_activated", "session:rewind_applied"]) {
    eventBus.subscribe(type, (data) => published.push({ type, data }));
  }
  const rollbackCalls = [];
  let activeBranch = "br_main";
  const service = createRewindService({
    eventBus,
    getTimeline: async () => [
      { seq: 1, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
      { seq: 2, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" },
      { seq: 3, event_id: "evt_apply_2", type: "file:diff_applied", change_id: "change_2", files: ["b.txt"], branch_id: "br_main" }
    ],
    getActiveBranchId: async () => activeBranch,
    createBranch: async (input) => ({ branch_id: "br_child", ...input }),
    activateBranch: async (branchId) => { activeBranch = branchId; return { branch_id: branchId }; },
    rollback: async (input) => {
      rollbackCalls.push(input);
      return { status: "success", metadata: { change_id: input.change_id, files: [] } };
    }
  });

  const result = await service.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "success");
  assert.deepEqual(rollbackCalls.map((call) => call.change_id), ["change_2", "change_1"]);
  // Rollback calls carry the planned child branch id so file events land on the new branch
  assert.ok(rollbackCalls.every((call) => call.branch_id?.startsWith("br_")), "rollback calls must carry planned branch_id");
  assert.equal(activeBranch, "br_child");
  assert.equal(published.some((event) => event.type === "session:rewind_applied"), true);
});

test("rewind apply stops on conflict and does not activate child branch", async () => {
  const eventBus = createEventBus();
  const conflicts = [];
  eventBus.subscribe("session:rewind_conflict", (data) => conflicts.push(data));
  let activeBranch = "br_main";
  const service = createRewindService({
    eventBus,
    getTimeline: async () => [
      { seq: 1, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
      { seq: 2, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" },
      { seq: 3, event_id: "evt_apply_2", type: "file:diff_applied", change_id: "change_2", files: ["b.txt"], branch_id: "br_main" }
    ],
    getActiveBranchId: async () => activeBranch,
    createBranch: async () => { throw new Error("should not create branch on conflict"); },
    activateBranch: async () => { throw new Error("should not activate branch on conflict"); },
    rollback: async ({ change_id }) => change_id === "change_2"
      ? { status: "conflict", metadata: { change_id, conflicts: [{ path: "b.txt", reason: "dirty" }] } }
      : { status: "success", metadata: { change_id } }
  });

  const result = await service.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "conflict");
  assert.equal(activeBranch, "br_main");
  assert.equal(result.failed_change_id, "change_2");
  assert.equal(conflicts.length, 1);
});

test("rewind apply handles force flag and failed rollback", async () => {
  const eventBus = createEventBus();
  const failed = [];
  eventBus.subscribe("session:rewind_failed", (data) => failed.push(data));
  const rollbackCalls = [];
  const service = createRewindService({
    eventBus,
    getTimeline: async () => [
      { seq: 1, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
      { seq: 2, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" }
    ],
    getActiveBranchId: async () => "br_main",
    createBranch: async () => ({ branch_id: "br_unused" }),
    activateBranch: async () => {},
    rollback: async (input) => {
      rollbackCalls.push(input);
      return { status: "failed", content: [{ text: "rollback error" }] };
    }
  });

  const result = await service.apply({ target: { turn_id: "turn_1" }, force: true });

  assert.equal(result.status, "failed");
  assert.equal(rollbackCalls[0].force, true);
  assert.equal(failed.length, 1);
});
