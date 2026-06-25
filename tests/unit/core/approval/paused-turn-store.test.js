import test from "node:test";
import assert from "node:assert/strict";
import { createPausedTurnStore } from "../../../../src/core/approval/paused-turn-store.js";

test("paused turn store saves gets and takes records once", () => {
  const store = createPausedTurnStore({ now: () => "2026-05-30T00:00:00.000Z" });
  const record = {
    approval_id: "approval_1",
    turn_id: "turn_1",
    approval: { id: "approval_1" },
    turn: { id: "turn_1" },
    resume_state: { pending_tool_call: { id: "call_1" } }
  };

  store.save(record);

  assert.equal(store.size(), 1);
  assert.equal(store.get("approval_1").created_at, "2026-05-30T00:00:00.000Z");
  assert.equal(store.take("approval_1").turn_id, "turn_1");
  assert.equal(store.get("approval_1"), null);
  assert.equal(store.take("approval_1"), null);
});

test("paused turn store rejects duplicate approval ids", () => {
  const store = createPausedTurnStore();
  const record = {
    approval_id: "approval_1",
    turn_id: "turn_1",
    approval: { id: "approval_1" },
    turn: { id: "turn_1" },
    resume_state: {}
  };

  store.save(record);

  assert.throws(() => store.save(record), /paused approval already exists/);
});

test("paused turn store deletes records for a turn and clears all", () => {
  const store = createPausedTurnStore();
  store.save({ approval_id: "a1", turn_id: "t1", approval: { id: "a1" }, turn: { id: "t1" }, resume_state: {} });
  store.save({ approval_id: "a2", turn_id: "t2", approval: { id: "a2" }, turn: { id: "t2" }, resume_state: {} });

  assert.equal(store.deleteForTurn("t1"), 1);
  assert.equal(store.get("a1"), null);
  assert.equal(store.get("a2").turn_id, "t2");

  store.clear();
  assert.equal(store.size(), 0);
});

test("paused turn store validates required fields", () => {
  const store = createPausedTurnStore();

  assert.throws(() => store.save({}), /approval_id is required/);
  assert.throws(
    () => store.save({ approval_id: "a", turn_id: "t", approval: { id: "different" }, turn: {}, resume_state: {} }),
    /approval.id must match approval_id/
  );
});

test("paused turn store can restore list and cancel durable records", () => {
  const store = createPausedTurnStore({ now: () => "2026-06-01T00:00:00.000Z" });
  store.restore({
    approval_id: "approval_1",
    turn_id: "turn_1",
    approval: { id: "approval_1" },
    turn: { id: "turn_1" },
    resume_state: { pending_tool_call: { id: "call_1" } }
  });

  assert.deepEqual(store.list().map((item) => item.approval_id), ["approval_1"]);
  assert.equal(store.list()[0].created_at, "2026-06-01T00:00:00.000Z");
  assert.equal(store.delete("approval_1"), true);
  assert.deepEqual(store.list(), []);
});
