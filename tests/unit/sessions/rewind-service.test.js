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
    createBranch: async (input) => ({ branch_id: input.branch_id || "br_child", ...input }),
    activateBranch: async (branchId) => { activeBranch = branchId; return { branch_id: branchId }; },
    rollback: async (input) => {
      rollbackCalls.push(input);
      return { status: "success", metadata: { change_id: input.change_id, files: [] } };
    }
  });

  const result = await service.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "success");
  assert.deepEqual(rollbackCalls.map((call) => call.change_id), ["change_2", "change_1"]);
  // Rollback events must carry the actual created branch id, not a phantom one
  const actualBranchId = result.branch_id;
  assert.ok(actualBranchId.startsWith("br_"), "branch id must be valid");
  assert.equal(rollbackCalls[0].branch_id, actualBranchId);
  assert.equal(rollbackCalls[1].branch_id, actualBranchId);
  assert.equal(activeBranch, actualBranchId);
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

  assert.equal(result.status, "failed_restored");
  assert.equal(rollbackCalls[0].force, true);
  assert.ok(failed.length >= 1);
});

test("rewind apply restores files when createBranch fails after rollback", async () => {
  const eventBus = createEventBus();
  const restored = [];
  eventBus.subscribe("session:rewind_restored", (data) => restored.push(data));
  let fileState = "after edit";
  const service = createRewindService({
    eventBus,
    projectRoot: "/virtual",
    getTimeline: async () => [
      { seq: 1, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
      { seq: 2, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" }
    ],
    getActiveBranchId: async () => "br_main",
    captureSnapshots: async () => [{ path: "a.txt", existed_before: true, before: "after edit" }],
    restoreSnapshots: async () => { fileState = "after edit"; return ["a.txt"]; },
    createBranch: async () => { throw new Error("secret branch store failure"); },
    activateBranch: async () => { throw new Error("should not activate"); },
    rollback: async () => { fileState = "before edit"; return { status: "success", metadata: { change_id: "change_1" } }; }
  });

  const result = await service.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "failed_restored");
  assert.equal(result.phase, "create_branch");
  assert.equal(result.reason, "branch_create_failed");
  assert.equal(fileState, "after edit");
  assert.deepEqual(result.restored_files, ["a.txt"]);
  assert.equal(restored.length, 1);
  assert.equal(JSON.stringify(restored).includes("secret branch store failure"), false);
});

test("rewind apply restores files when activateBranch fails after branch creation", async () => {
  const eventBus = createEventBus();
  let activeBranch = "br_main";
  let fileState = "after edit";
  const service = createRewindService({
    eventBus,
    projectRoot: "/virtual",
    getTimeline: async () => [
      { seq: 1, event_id: "evt_user_1", type: "user:message", turn_id: "turn_1", branch_id: "br_main" },
      { seq: 2, event_id: "evt_apply_1", type: "file:diff_applied", change_id: "change_1", files: ["a.txt"], branch_id: "br_main" }
    ],
    getActiveBranchId: async () => activeBranch,
    captureSnapshots: async () => [{ path: "a.txt", existed_before: true, before: "after edit" }],
    restoreSnapshots: async () => { fileState = "after edit"; return ["a.txt"]; },
    createBranch: async (input) => ({ branch_id: input.branch_id, parent_branch_id: "br_main" }),
    activateBranch: async () => { throw new Error("cannot activate secret branch"); },
    rollback: async () => { fileState = "before edit"; return { status: "success", metadata: { change_id: "change_1" } }; }
  });

  const result = await service.apply({ target: { turn_id: "turn_1" } });

  assert.equal(result.status, "failed_restored");
  assert.equal(result.phase, "activate_branch");
  assert.equal(result.reason, "branch_activate_failed");
  assert.equal(fileState, "after edit");
  assert.equal(activeBranch, "br_main");
});
