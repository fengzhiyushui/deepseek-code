import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../src/shared/event-bus.js";

test("v2 event bus publishes data with metadata", () => {
  const bus = createEventBus();
  const received = [];

  bus.subscribe("agent:step", (data, meta) => {
    received.push({ data, meta });
  });

  bus.publish("agent:step", { step_id: "step_1" });

  assert.equal(received.length, 1);
  assert.equal(received[0].data.step_id, "step_1");
  assert.equal(received[0].meta.event_type, "agent:step");
  assert.ok(received[0].meta.event_id.startsWith("evt_"));
  assert.ok(Date.parse(received[0].meta.timestamp) > 0);
});

test("v2 event bus unsubscribe stops delivery", () => {
  const bus = createEventBus();
  let count = 0;

  const sub = bus.subscribe("agent:final", () => {
    count += 1;
  });

  sub.unsubscribe();
  bus.publish("agent:final", { content: "done" });

  assert.equal(count, 0);
});

test("v2 event bus isolates subscriber failures", () => {
  const bus = createEventBus();
  const received = [];

  bus.subscribe("tool:result", () => {
    throw new Error("subscriber failure");
  });
  bus.subscribe("tool:result", (data) => {
    received.push(data);
  });

  assert.doesNotThrow(() => {
    bus.publish("tool:result", { status: "success" });
  });
  assert.deepEqual(received, [{ status: "success" }]);
});
