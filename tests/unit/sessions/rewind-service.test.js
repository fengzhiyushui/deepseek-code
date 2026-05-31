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

test("rewind apply throws unavailable error before V2-12C", async () => {
  const service = createRewindService({
    eventBus: createEventBus(),
    getTimeline: async () => [],
    getActiveBranchId: async () => "br_main",
    rollback: async () => ({ status: "success" })
  });

  await assert.rejects(
    () => service.apply({ target: { seq: 1 } }),
    /rewind apply unavailable/
  );
});
