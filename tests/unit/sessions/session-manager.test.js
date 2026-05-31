import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createSessionManager } from "../../../src/sessions/session-manager.js";

test("session manager subscribes to events without allowing payload type overwrite", () => {
  const eventBus = createEventBus();
  const session = createSessionManager({ eventBus, eventLog: null });
  const events = [];
  const sub = session.subscribe((event) => events.push(event));

  eventBus.publish("agent:final", { content: "done", type: "fake" });
  sub.unsubscribe();

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "agent:final");
  assert.equal(events[0].content, "done");
});

test("session manager persists bridged events and flush waits for writes", async () => {
  const eventBus = createEventBus();
  const writes = [];
  const eventLog = {
    append: async (type, data, meta) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      writes.push({ type, data, meta });
    },
    flush: async () => {},
    tail: async (count) => writes.slice(-count).map((entry) => ({ type: entry.type, ...entry.data }))
  };
  const session = createSessionManager({ eventBus, eventLog });

  eventBus.publish("user:message", { content: "hi" });
  eventBus.publish("agent:final", { content: "done" });
  await session.flush();

  assert.deepEqual(writes.map((write) => write.type), ["user:message", "agent:final"]);
  const timeline = await session.getTimeline(2);
  assert.deepEqual(timeline.map((event) => event.type), ["user:message", "agent:final"]);
});

test("session manager isolates persistence failures from live subscribers", async () => {
  const eventBus = createEventBus();
  const errors = [];
  const events = [];
  const session = createSessionManager({
    eventBus,
    eventLog: {
      append: async () => { throw new Error("disk full"); },
      flush: async () => {},
      tail: async () => []
    },
    onError: (error, type) => errors.push(`${type}:${error.message}`)
  });
  const sub = session.subscribe((event) => events.push(event));

  eventBus.publish("user:message", { content: "hi" });
  await session.flush();
  sub.unsubscribe();

  assert.deepEqual(errors, ["user:message:disk full"]);
  assert.equal(events[0].type, "user:message");
});

test("session manager stamps active branch id on live and persisted events", async () => {
  const eventBus = createEventBus();
  const writes = [];
  const session = createSessionManager({
    eventBus,
    eventLog: {
      append: async (type, data) => writes.push({ type, data }),
      flush: async () => {},
      tail: async () => writes.map((entry, index) => ({ seq: index + 1, type: entry.type, ...entry.data }))
    },
    getActiveBranchId: () => "br_feature"
  });
  const events = [];
  const sub = session.subscribe((event) => events.push(event));

  eventBus.publish("user:message", { content: "hi" });
  await session.flush();
  sub.unsubscribe();

  assert.equal(events[0].branch_id, "br_feature");
  assert.equal(writes[0].data.branch_id, "br_feature");
});

test("session getTimeline filters active branch while keeping br_main ancestors", async () => {
  const eventBus = createEventBus();
  const timeline = [
    { seq: 1, type: "session:start", branch_id: "br_main" },
    { seq: 2, type: "agent:final", branch_id: "br_main" },
    { seq: 3, type: "session:branch_created", branch_id: "br_child", parent_branch_id: "br_main" },
    { seq: 4, type: "agent:final", branch_id: "br_child" },
    { seq: 5, type: "agent:final", branch_id: "br_other" }
  ];
  const session = createSessionManager({
    eventBus,
    eventLog: {
      append: async () => {},
      flush: async () => {},
      tail: async () => timeline
    },
    getActiveBranchId: () => "br_child",
    getBranchAncestry: async () => [
      { branch_id: "br_main", forked_from_seq: 0 },
      { branch_id: "br_child", forked_from_seq: 2 }
    ]
  });

  const active = await session.getTimeline({ count: 20 });
  assert.deepEqual(active.map((event) => event.seq), [1, 2, 3, 4]);

  const all = await session.getTimeline({ count: 20, all_branches: true });
  assert.deepEqual(all.map((event) => event.seq), [1, 2, 3, 4, 5]);
});

test("session manager preserves payload branch_id on branch control events", async () => {
  const eventBus = createEventBus();
  const writes = [];
  const session = createSessionManager({
    eventBus,
    eventLog: {
      append: async (type, data) => writes.push({ type, data }),
      flush: async () => {},
      tail: async () => []
    },
    getActiveBranchId: () => "br_main"
  });
  const events = [];
  const sub = session.subscribe((event) => events.push(event));

  // Publish branch_created from a child branch BEFORE activation
  eventBus.publish("session:branch_created", {
    branch_id: "br_child",
    parent_branch_id: "br_main",
    forked_from_event_id: "evt_1",
    forked_from_seq: 5
  });
  await session.flush();
  sub.unsubscribe();

  // Payload branch_id "br_child" must survive, not be overwritten to "br_main"
  assert.equal(events[0].branch_id, "br_child");
  assert.equal(writes[0].data.branch_id, "br_child");
  assert.equal(writes[0].data.parent_branch_id, "br_main");
});

test("session manager preserves payload branch_id on rollback file events", async () => {
  const eventBus = createEventBus();
  const writes = [];
  const session = createSessionManager({
    eventBus,
    eventLog: {
      append: async (type, data) => writes.push({ type, data }),
      flush: async () => {},
      tail: async () => []
    },
    getActiveBranchId: () => "br_main"
  });
  const events = [];
  const sub = session.subscribe((event) => events.push(event));

  // Rollback events during rewind carry the planned child branch_id
  eventBus.publish("file:transaction_rolled_back", {
    branch_id: "br_child",
    change_id: "change_1",
    files: ["a.txt"]
  });
  eventBus.publish("file:rollback_applied", {
    branch_id: "br_child",
    change_id: "change_1",
    files: ["a.txt"]
  });
  await session.flush();
  sub.unsubscribe();

  assert.equal(events[0].branch_id, "br_child");
  assert.equal(events[1].branch_id, "br_child");
  assert.equal(writes[0].data.branch_id, "br_child");
  assert.equal(writes[1].data.branch_id, "br_child");
});

test("session manager dispose stops bridge writes", async () => {
  const eventBus = createEventBus();
  const writes = [];
  const session = createSessionManager({
    eventBus,
    eventLog: {
      append: async (type) => writes.push(type),
      flush: async () => {},
      tail: async () => []
    }
  });

  eventBus.publish("user:message", { content: "before" });
  await session.flush();
  session.dispose();
  eventBus.publish("agent:final", { content: "after" });
  await session.flush();

  assert.deepEqual(writes, ["user:message"]);
});
