import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";

function st(id) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }; }

function build({ subtasks, workerFor, replan = async () => ({ done: true, subtasks: [] }), onPlan = () => {}, maxRounds = 2 }) {
  return createOrchestrator({
    planner: { plan: async () => { onPlan(); return { task_summary: "t", done_when: "d", subtasks }; }, replan },
    makeWorkerFactory: () => ({ worker: (s) => workerFor(s) }),
    makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async ({ collected }) => collected.map((c) => `${c.st.id}=${c.status}`).join(",") },
    makeBudget: () => ({ exceeded: () => null }),
    maxSubtasks: 8, maxWorkerAttempts: 1, eventBus: { publish() {} }, makeContext: async () => null, maxRounds
  });
}

test("pause -> resume continues without re-plan or duplicate dispatch", async () => {
  let planCalls = 0;
  const pausedWorker = { send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }), approve: async () => ({ status: "complete", content: "did a" }) };
  const orch = build({
    subtasks: [st("a"), st("b")],
    workerFor: (s) => (s.id === "a" ? pausedWorker : { send: async () => ({ status: "complete", content: "did b" }) }),
    onPlan: () => { planCalls += 1; }
  });
  const p = await orch.run({ message: "m", options: { autonomy: "gated" } });
  assert.equal(p.status, "awaiting_approval");
  assert.equal(orch.hasPaused("ap1"), true);
  const done = await orch.resume("ap1", "approve");
  assert.equal(done.status, "complete");
  assert.match(done.content, /a=complete/);
  assert.match(done.content, /b=complete/);
  assert.equal(planCalls, 1);                       // NOT re-planned
  assert.equal(done.collected.filter((c) => c.st.id === "a").length, 1);  // no duplicate
  assert.equal(orch.hasPaused("ap1"), false);       // consumed
});

test("multi-pause chain: approve -> pause again -> approve -> complete", async () => {
  let aDone = false, bDone = false;
  const workerA = { send: async () => ({ status: "awaiting_approval", approval: { id: "apA" } }), approve: async () => { aDone = true; return { status: "complete", content: "a" }; } };
  const workerB = { send: async () => ({ status: "awaiting_approval", approval: { id: "apB" } }), approve: async () => { bDone = true; return { status: "complete", content: "b" }; } };
  const orch = build({ subtasks: [st("a"), st("b")], workerFor: (s) => (s.id === "a" ? workerA : workerB) });
  const p1 = await orch.run({ message: "m", options: { autonomy: "gated" } });
  assert.equal(p1.approval.id, "apA");
  const p2 = await orch.resume("apA", "approve");     // a approved -> b pauses
  assert.equal(p2.status, "awaiting_approval");
  assert.equal(p2.approval.id, "apB");
  assert.equal(orch.hasPaused("apA"), false);         // old consumed
  assert.equal(orch.hasPaused("apB"), true);          // new stored
  const done = await orch.resume("apB", "approve");
  assert.equal(done.status, "complete");
  assert.ok(aDone && bDone);
  assert.match(done.content, /a=complete/);
  assert.match(done.content, /b=complete/);
});

test("deny -> paused subtask failed, loop continues", async () => {
  const pausedWorker = { send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }), approve: async () => ({ status: "complete", content: "x" }) };
  const orch = build({ subtasks: [st("a"), st("b")], workerFor: (s) => (s.id === "a" ? pausedWorker : { send: async () => ({ status: "complete", content: "ok" }) }) });
  await orch.run({ message: "m", options: { autonomy: "gated" } });
  const done = await orch.resume("ap1", "deny");
  assert.match(done.content, /a=failed/);
  assert.match(done.content, /b=complete/);
  assert.equal(done.outcome, "partial");
});

test("resume unknown id throws", async () => {
  const orch = build({ subtasks: [st("a")], workerFor: () => ({ send: async () => ({ status: "complete", content: "x" }) }) });
  await assert.rejects(() => orch.resume("nope", "approve"), (e) => e.code === "ORCH_NOT_PAUSED");
});
