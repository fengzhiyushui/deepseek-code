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
