import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";
import { serializeOrchestrationState } from "../../../src/core/orchestration/orchestration-recovery-contract.js";

function stub(id) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }; }
function noBudget() { return { exceeded: () => null, snapshot: () => ({ tokens: 0, model_calls: 0, max_tokens: null, max_model_calls: null }) }; }

function makeSidecar({ approvalId = "ap1", taskId = "task_1", sessionId = "s", subtaskId = "a", remaining = [] } = {}) {
  const state = {
    message: "m", done_when: "d", options: { autonomy: "gated", sessionId },
    plan: { subtasks: [stub(subtaskId)] }, round: 1, allCollected: [],
    seenSubtaskIds: new Set([subtaskId]), seenFp: new Set(["fp"]), budget: noBudget(),
    adoptedExperienceIds: [], riskCues: new Set(), taskId, sessionId, env: { root: "/root", orchestrationConfig: {} }
  };
  return serializeOrchestrationState(state, { approvalId, pausedSubtask: stub(subtaskId), remaining });
}
function makeWorkerRecord({ approvalId = "ap1", taskId = "task_1", sessionId = "s", subtaskId = "a", marker = true } = {}) {
  return { approval_id: approvalId, turn_id: "t", approval: { id: approvalId }, turn: {}, resume_state: { options: marker ? { __orchestration: { taskId, sessionId, subtaskId } } : {} } };
}

function buildDurable(opts = {}) {
  const {
    workerFor, replan = async () => ({ done: true, subtasks: [] }), onPlan = () => {},
    sidecar = makeSidecar(), workerRecord = makeWorkerRecord(), reviewerPass = true, onWorkerBuild = () => {},
    orchConsumeSpy = () => {}, orchSaveSpy = () => {}, workerConsumeSpy = () => {}
  } = opts;
  return createOrchestrator({
    planner: { plan: async () => { onPlan(); return { subtasks: [] }; }, replan },
    makeWorkerFactory: () => ({ worker: (st) => { onWorkerBuild(st); return workerFor(st); } }),
    makeReviewerFor: () => ({ review: async () => ({ pass: reviewerPass, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async ({ collected }) => collected.map((c) => `${c.st.id}=${c.status}`).join(",") },
    makeBudget: () => noBudget(), makeResumedBudget: () => noBudget(),
    maxSubtasks: 8, maxWorkerAttempts: 1, eventBus: { publish() {} }, makeContext: async () => null, maxRounds: 2,
    orchPersistence: { load: async () => sidecar, consume: async (id) => orchConsumeSpy(id), save: async (id, json) => orchSaveSpy(id, json) },
    pausedTurnStore: { get: () => workerRecord, delete: () => {} },
    pausedTurnPersistence: { consume: async (id) => workerConsumeSpy(id) },
    env: { root: "/root", orchestrationConfig: {} }
  });
}

test("resumeDurable: gate passes → rebuild + approve → settle → complete (no re-plan)", async () => {
  let planCalls = 0, approveCalls = 0, orchConsumed = null;
  const orch = buildDurable({
    workerFor: () => ({ approve: async () => { approveCalls += 1; return { status: "complete", content: "did a" }; } }),
    onPlan: () => { planCalls += 1; }, orchConsumeSpy: (id) => { orchConsumed = id; }
  });
  const done = await orch.resumeDurable("ap1", "approve");
  assert.equal(done.status, "complete");
  assert.match(done.content, /a=complete/);
  assert.equal(approveCalls, 1);
  assert.equal(planCalls, 0);          // durable resume never re-plans
  assert.equal(orchConsumed, "ap1");   // orchestration sidecar consumed on completion
});

test("resumeDurable: fingerprint mismatch → ORCH_RECOVERY_BLOCKED, no rebuild, no approve (CST-6)", async () => {
  let built = 0, approveCalls = 0;
  const bad = makeSidecar(); bad.fingerprints = { workerFactory: 9, toolSubset: 1, subtaskSchema: 1 };
  const orch = buildDurable({
    sidecar: bad, onWorkerBuild: () => { built += 1; },
    workerFor: () => ({ approve: async () => { approveCalls += 1; return { status: "complete" }; } })
  });
  await assert.rejects(() => orch.resumeDurable("ap1", "approve"), (e) => e.code === "ORCH_RECOVERY_BLOCKED");
  assert.equal(built, 0);
  assert.equal(approveCalls, 0);
});

test("resumeDurable: ownership mismatch → blocked (CST-7)", async () => {
  const orch = buildDurable({
    workerRecord: makeWorkerRecord({ subtaskId: "WRONG" }),
    workerFor: () => ({ approve: async () => ({ status: "complete" }) })
  });
  await assert.rejects(() => orch.resumeDurable("ap1", "approve"), (e) => e.code === "ORCH_RECOVERY_BLOCKED");
});

test("resumeDurable: missing worker record → blocked (orphan, CST-4)", async () => {
  const orch = buildDurable({ workerRecord: null, workerFor: () => ({ approve: async () => ({ status: "complete" }) }) });
  await assert.rejects(() => orch.resumeDurable("ap1", "approve"), (e) => e.code === "ORCH_RECOVERY_BLOCKED");
});

test("resumeDurable: deny → paused subtask failed, worker sidecar consumed, round continues", async () => {
  let workerConsumed = null;
  const orch = buildDurable({
    workerFor: () => ({ approve: async () => { throw new Error("approve must not be called on deny"); } }),
    workerConsumeSpy: (id) => { workerConsumed = id; }
  });
  const done = await orch.resumeDurable("ap1", "deny");
  assert.match(done.content, /a=failed/);
  assert.equal(done.outcome, "partial");
  assert.equal(workerConsumed, "ap1");   // deny path consumes the worker sidecar (agent-runtime didn't)
});

test("resumeDurable: re-pause writes a new durable sidecar and consumes the old", async () => {
  let saved = null, orchConsumed = null;
  const workers = {
    a: { approve: async () => ({ status: "complete", content: "a" }) },
    b: { send: async () => ({ status: "awaiting_approval", approval: { id: "ap2" } }) }
  };
  const orch = buildDurable({
    sidecar: makeSidecar({ subtaskId: "a", remaining: [stub("b")] }),
    workerFor: (st) => (st.id === "a" ? workers.a : workers.b),
    orchSaveSpy: (id) => { saved = id; }, orchConsumeSpy: (id) => { orchConsumed = id; }
  });
  const res = await orch.resumeDurable("ap1", "approve");
  assert.equal(res.status, "awaiting_approval");
  assert.equal(res.approval.id, "ap2");
  assert.equal(saved, "ap2");          // new durable sidecar written
  assert.equal(orchConsumed, "ap1");   // old consumed
  assert.equal(orch.hasPaused("ap2"), true);  // also tracked in-memory for same-process re-resume
});
