import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createAgentRuntime } from "../../../src/core/runtime/agent-runtime.js";

test("agent runtime completes a mock query turn", async () => {
  const bus = createEventBus();
  const events = [];
  bus.subscribe("agent:turn_started", (data) => events.push(["turn", data]));
  bus.subscribe("agent:step", (data) => events.push(["step", data]));
  bus.subscribe("agent:final", (data) => events.push(["final", data]));

  const runtime = createAgentRuntime({
    eventBus: bus,
    sessionId: "sess_test",
    modelGateway: {
      reply: async ({ classification }) => ({
        content: `mock ${classification.task_type} response`
      })
    }
  });

  const result = await runtime.send("what does this project do?", { autonomy: "auto" });

  assert.equal(result.status, "complete");
  assert.equal(result.state, "idle");
  assert.equal(result.content, "mock query response");
  assert.equal(result.turn.session_id, "sess_test");
  assert.ok(events.some(([type]) => type === "turn"));
  assert.ok(events.some(([type]) => type === "step"));
  assert.ok(events.some(([type]) => type === "final"));
});

test("agent runtime rejects concurrent turns", async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });

  const runtime = createAgentRuntime({
    sessionId: "sess_test",
    modelGateway: {
      reply: async () => {
        await blocked;
        return { content: "released" };
      }
    }
  });

  const first = runtime.send("what is this?");

  await assert.rejects(
    () => runtime.send("second"),
    /another turn is in progress/
  );

  release();
  await first;
});

test("agent runtime interrupt returns to idle", async () => {
  const runtime = createAgentRuntime({ sessionId: "sess_test" });

  const before = runtime.getState();
  runtime.interrupt("turn_missing");
  const after = runtime.getState();

  assert.equal(before.current, "idle");
  assert.equal(after.current, "idle");
});

test("agent runtime approve publishes approval resolution", () => {
  const bus = createEventBus();
  const approvals = [];
  bus.subscribe("approval:resolved", (data) => approvals.push(data));

  const runtime = createAgentRuntime({ eventBus: bus, sessionId: "sess_test" });
  runtime.approve("approval_1", "approve");

  assert.deepEqual(approvals, [{ approval_id: "approval_1", decision: "approve" }]);
});

test("agent runtime interrupt cancels in-flight turn and prevents stale events", async () => {
  const bus = createEventBus();
  const events = [];
  bus.subscribe("agent:final", (data) => events.push(["final", data]));
  bus.subscribe("agent:error", (data) => events.push(["error", data]));

  let release;
  const blocked = new Promise((resolve) => { release = resolve; });

  const runtime = createAgentRuntime({
    eventBus: bus,
    sessionId: "sess_cancel",
    modelGateway: {
      reply: async () => {
        await blocked;
        return { content: "stale response" };
      }
    }
  });

  // Start a turn that blocks on modelGateway
  const first = runtime.send("long task");
  await new Promise(r => setTimeout(r, 20));

  // Interrupt should cancel the turn
  runtime.interrupt();

  // Release the blocked gateway — the old turn should throw InterruptedError
  release();
  await assert.rejects(() => first, /turn was interrupted/);

  // No agent:final or agent:error should have been published for the old turn
  assert.equal(events.length, 0, "interrupted turn must not publish final or error events");
});

test("interrupted turn cleanup does not corrupt a new turn", async () => {
  const bus = createEventBus();
  let releaseA, releaseB;
  const blockedA = new Promise((r) => { releaseA = r; });
  const blockedB = new Promise((r) => { releaseB = r; });
  let callCount = 0;

  const runtime = createAgentRuntime({
    eventBus: bus,
    sessionId: "sess_race",
    modelGateway: {
      reply: async () => {
        callCount++;
        if (callCount === 1) { await blockedA; return { content: "A" }; }
        if (callCount === 2) { await blockedB; return { content: "B" }; }
        return { content: "C" };
      }
    }
  });

  // Turn A: blocks on modelGateway
  const turnA = runtime.send("task A");

  // Interrupt A
  runtime.interrupt();

  // Turn B: starts immediately, blocks on modelGateway
  const turnB = runtime.send("task B");

  // Release A's gateway — the late response must NOT corrupt B's state
  releaseA();
  await assert.rejects(() => turnA, /turn was interrupted/);

  // Turn C must be rejected because B is still running
  await assert.rejects(() => runtime.send("task C"), /another turn is in progress/);

  // Release B — should complete normally
  releaseB();
  const resultB = await turnB;
  assert.equal(resultB.status, "complete");
  assert.equal(resultB.content, "B");
});
