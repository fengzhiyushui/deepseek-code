// test/kernel/event-bus.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../src/kernel/event-bus.js";

test("subscribe receives published events", () => {
  const bus = createEventBus();
  const received = [];
  bus.subscribe("test:event", (data) => received.push(data));
  bus.publish("test:event", { value: 42 });
  assert.equal(received.length, 1);
  assert.equal(received[0].value, 42);
});

test("unsubscribe stops receiving events", () => {
  const bus = createEventBus();
  const received = [];
  const sub = bus.subscribe("test:event", (data) => received.push(data));
  sub.unsubscribe();
  bus.publish("test:event", { value: 1 });
  assert.equal(received.length, 0);
});

test("multiple subscribers on same event type all receive", () => {
  const bus = createEventBus();
  let a = 0, b = 0;
  bus.subscribe("e", () => a++);
  bus.subscribe("e", () => b++);
  bus.publish("e", {});
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test("publish to event with no subscribers does not throw", () => {
  const bus = createEventBus();
  assert.doesNotThrow(() => bus.publish("no.listeners", {}));
});

test("once receives event exactly once then auto-unsubscribes", () => {
  const bus = createEventBus();
  const received = [];
  bus.once("once:event", (data) => received.push(data));
  bus.publish("once:event", { first: true });
  bus.publish("once:event", { second: true });
  assert.equal(received.length, 1);
  assert.equal(received[0].first, true);
});

test("different event types are isolated", () => {
  const bus = createEventBus();
  const typeA = [];
  const typeB = [];
  bus.subscribe("a", (d) => typeA.push(d));
  bus.subscribe("b", (d) => typeB.push(d));
  bus.publish("a", { n: 1 });
  assert.equal(typeA.length, 1);
  assert.equal(typeB.length, 0);
});

test("events carry timestamp and event_id", () => {
  const bus = createEventBus();
  const events = [];
  bus.subscribe("typed", (data, meta) => events.push(meta));
  bus.publish("typed", { x: 1 });
  assert.equal(events.length, 1);
  assert.ok(typeof events[0].timestamp === "string");
  assert.ok(Date.parse(events[0].timestamp) > 0);
  assert.ok(events[0].event_id.startsWith("evt_"));
  assert.ok(events[0].event_type === "typed");
});

test("handler error does not prevent other subscribers", () => {
  const bus = createEventBus();
  const received = [];
  bus.subscribe("e", () => { throw new Error("boom"); });
  bus.subscribe("e", (data) => received.push(data));
  assert.doesNotThrow(() => bus.publish("e", { x: 1 }));
  assert.equal(received.length, 1);
  assert.equal(received[0].x, 1);
});

test("once unsubscribe before event prevents handler", () => {
  const bus = createEventBus();
  let called = false;
  const sub = bus.once("e", () => { called = true; });
  sub.unsubscribe();
  bus.publish("e", {});
  assert.equal(called, false);
});
