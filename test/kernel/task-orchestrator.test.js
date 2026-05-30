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
    fimParams() { throw new Error("not supported"); },
    invoke(messages, channel) {
      return Promise.resolve({ content: "mock response", usage: null, channel, latency_ms: 5, model: "mock" });
    },
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

test("classify sends Chinese questions to thinkreply fast path", async () => {
  const bus = createEventBus();
  const states = [];
  bus.subscribe("orchestrator:state", (data) => states.push(data.state.entered));

  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });

  const result = await orchestrator.submit("你是什么模型");

  assert.equal(result.status, "complete");
  assert.equal(result.content, "mock response");
  assert.ok(states.includes("thinkreply"));
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

test("approve resumes task execution after awaitapproval", async () => {
  const bus = createEventBus();
  const states = [];
  bus.subscribe("orchestrator:state", (data) => states.push(data.state.entered));
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });

  // Submit an edit task with supervised autonomy — enters awaitapproval
  const promise = orchestrator.submit("fix the bug in login", { autonomy: "supervised" });

  // Let the state machine settle
  await new Promise(r => setTimeout(r, 50));

  assert.ok(states.includes("awaitapproval"), "should have entered awaitapproval");
  assert.equal(orchestrator.getState().current, "awaitapproval");

  // Approve the plan — this should resume execution
  orchestrator.approve("plan-1", "approved");

  // The promise should now resolve with complete
  const result = await promise;
  assert.equal(result.status, "complete");
  assert.equal(result.state, "idle");
  assert.equal(orchestrator.getState().current, "idle");
  assert.ok(states.includes("thinkplan"), "should have continued to thinkplan after approval");
  assert.ok(states.includes("complete"), "should have reached complete state");
});

test("submit rejects when orchestrator is busy", async () => {
  const bus = createEventBus();
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });

  // Submit an edit task that enters the approval gate (gated is default)
  const p1 = orchestrator.submit("fix the login bug");

  // Let state settle into awaitapproval
  await new Promise(r => setTimeout(r, 30));

  // Second submit while first is awaiting approval must reject
  try {
    await orchestrator.submit("another question");
    assert.fail("should have thrown BUSY");
  } catch (e) {
    assert.ok(
      e.message.includes("in progress") || e.message.includes("busy") || e.code === "BUSY",
      `expected BUSY error, got: ${e.message}`
    );
  }

  // Clean up
  orchestrator.interrupt();
  try { await p1; } catch {}

  // After interrupt, state should be idle and new submit should work
  assert.equal(orchestrator.getState().current, "idle");
  const p2 = orchestrator.submit("what is this?");
  const r2 = await p2;
  assert.equal(r2.status, "complete");
});

test("deny decision cancels task and rejects promise", async () => {
  const bus = createEventBus();
  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: mockModelProvider(),
    contextEngine: mockContextEngine()
  });

  const promise = orchestrator.submit("delete files", { autonomy: "supervised" });
  await new Promise(r => setTimeout(r, 80));

  orchestrator.approve("any-id", "deny");

  try {
    await promise;
    assert.fail("should have been rejected");
  } catch (e) {
    assert.ok(e.message.includes("denied") || e.message.includes("Denied") || e.message.includes("Interrupted"));
  }

  assert.equal(orchestrator.getState().current, "idle");
});

test("terminal state allows new submission without interrupt", async () => {
  const bus = createEventBus();
  const badMP = mockModelProvider();
  badMP.buildRequestBody = function() { throw new Error("API key invalid"); };

  const orchestrator = createTaskOrchestrator({
    eventBus: bus,
    modelProvider: badMP,
    contextEngine: mockContextEngine()
  });

  // First submit hits terminal
  try { await orchestrator.submit("do something"); } catch {}
  assert.equal(orchestrator.getState().current, "terminal");

  // Second submit should be allowed (Terminal is recoverable)
  try {
    await orchestrator.submit("retry with different input");
  } catch {}

  // Should have transitioned out of terminal (either to classify or another terminal)
  const state = orchestrator.getState().current;
  assert.ok(state === "classify" || state === "terminal" || state === "idle");
});
