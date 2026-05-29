// test/kernel/task-orchestrator.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createTaskOrchestrator } from "../../src/kernel/task-orchestrator.js";
import { createEventBus } from "../../src/kernel/event-bus.js";

function mockModelProvider() {
  return {
    channelParams(channel) {
      return channel === "think"
        ? { model: "mock-think", thinking: { type: "enabled" }, reasoning_effort: "high", max_tokens: 100, stream: false, temperature: undefined, response_format: { type: "json_object" } }
        : { model: "mock-act", thinking: { type: "disabled" }, max_tokens: 100, stream: true, temperature: 0.1, response_format: undefined };
    },
    buildRequestBody(messages, channel) { return { model: "mock", messages, channel }; },
    processResponse(resp, channel) { return { content: resp.content || "", reasoning_content: null, _reasoning_hidden: true, usage: resp.usage || null, channel }; },
    trackUsage() {},
    getUsageStats() { return { requests: 0 }; },
    supportsFIM() { return false; },
    fimParams() { throw new Error("not supported"); }
  };
}

function mockContextEngine() {
  return {
    scan: async () => {},
    snapshot: (phase, channel) => ({
      snapshot_id: "snap_test",
      channel, phase,
      units: [], unit_hashes: [],
      budget: { allocated: 1000, used: 0 },
      expected_cache_prefix_offset: 200,
      file_revision_hashes: {},
      assembly_order: []
    }),
    pin: () => {}, unpin: () => {}, warm: () => {}, evict: () => {},
    getCacheStats: () => ({ total_units: 0 }),
    setChannelConfig: () => {},
    getUnit: () => undefined,
    invalidate: () => Promise.resolve()
  };
}

test("initial state is Idle", () => {
  const bus = createEventBus();
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  assert.equal(orchestrator.getState().current, "idle");
});

test("submit transitions Idle -> Classify", async () => {
  const bus = createEventBus();
  const transitions = [];
  bus.subscribe("orchestrator:state", (data) => transitions.push(data.state.entered));
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  const promise = orchestrator.submit("explain this project");
  await new Promise(r => setTimeout(r, 50));
  orchestrator.interrupt();
  try { await promise; } catch {}
  assert.ok(transitions.includes("classify"));
});

test("classify detects query task type and takes fast path", async () => {
  const bus = createEventBus();
  const states = [];
  bus.subscribe("orchestrator:state", (data) => states.push(data.state.entered));
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  const promise = orchestrator.submit("what does this project do?");
  await new Promise(r => setTimeout(r, 50));
  orchestrator.interrupt();
  try { await promise; } catch {}
  assert.ok(states.includes("classify"));
  assert.ok(states.includes("thinkreply") || states.includes("complete"));
});

test("autonomy levels: supervised requires approval before plan", async () => {
  const bus = createEventBus();
  const approvals = [];
  bus.subscribe("orchestrator:state", (data) => {
    if (data.state.entered === "awaitapproval") approvals.push(data);
  });
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  const promise = orchestrator.submit("delete all files", { autonomy: "supervised" });
  await new Promise(r => setTimeout(r, 50));
  orchestrator.interrupt();
  try { await promise; } catch {}
  assert.ok(approvals.length >= 1);
});

test("autonomy levels: full-auto skips approvals", async () => {
  const bus = createEventBus();
  const approvals = [];
  bus.subscribe("orchestrator:state", (data) => {
    if (data.state.entered === "awaitapproval") approvals.push(data);
  });
  const mp = mockModelProvider();
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mp,
    contextEngine: mockContextEngine()
  });
  const promise = orchestrator.submit("add comment", { autonomy: "full-auto" });
  await new Promise(r => setTimeout(r, 100));
  orchestrator.interrupt();
  try { await promise; } catch {}
  assert.equal(approvals.length, 0);
});

test("state transitions emit orchestator:state events", async () => {
  const bus = createEventBus();
  const events = [];
  bus.subscribe("orchestrator:state", (data) => events.push(data));
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  const promise = orchestrator.submit("hello");
  await new Promise(r => setTimeout(r, 50));
  orchestrator.interrupt();
  try { await promise; } catch {}
  for (const evt of events) {
    assert.ok(typeof evt.state === "object");
    assert.ok(typeof evt.state.entered === "string");
    assert.ok(typeof evt.transition === "object");
    assert.ok(typeof evt.transition.reason === "string");
    assert.ok(typeof evt.trace === "object");
    assert.ok(typeof evt.trace.id === "string");
    assert.ok(evt.trace.id.startsWith("trace_"));
  }
});

test("interrupt sets state to idle", async () => {
  const bus = createEventBus();
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  const promise = orchestrator.submit("do something slow");
  await new Promise(r => setTimeout(r, 30));
  orchestrator.interrupt();
  try { await promise; } catch (e) {
    assert.ok(e.message.includes("interrupted") || e.message.includes("Interrupted"));
  }
  assert.equal(orchestrator.getState().current, "idle");
});

test("terminal state on unrecoverable error", async () => {
  const bus = createEventBus();
  const badMP = mockModelProvider();
  badMP.buildRequestBody = function() { throw new Error("API key invalid"); };
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: badMP,
    contextEngine: mockContextEngine()
  });
  const states = [];
  bus.subscribe("orchestrator:state", (data) => states.push(data.state.entered));
  const promise = orchestrator.submit("do something");
  await new Promise(r => setTimeout(r, 50));
  orchestrator.interrupt();
  try { await promise; } catch {}
  assert.ok(states.includes("terminal"));
});

test("getState returns current state with metadata", () => {
  const orchestrator = createTaskOrchestrator({
    eventBus: createEventBus(),
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });
  const state = orchestrator.getState();
  assert.equal(state.current, "idle");
  assert.equal(state.autonomy, "gated");
  assert.equal(state.channel, null);
});
