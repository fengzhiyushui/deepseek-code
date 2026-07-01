import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatchLoop } from "../../../src/core/orchestration/dispatch-loop.js";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";

function st(id) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }; }
const reviewerOk = () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) });

test("worker send options carry __orchestration marker when durable", async () => {
  let captured = null;
  const worker = { send: async (_p, opts) => { captured = opts; return { status: "awaiting_approval", approval: { id: "apX" } }; }, approve: async () => ({}) };
  await runDispatchLoop({
    plan: { subtasks: [st("a")] }, workerFactory: { worker: () => worker }, makeReviewer: reviewerOk,
    synthesizer: { synthesize: async () => "" }, budget: { exceeded: () => null }, maxWorkerAttempts: 1, autonomy: "gated",
    orchestrationMarker: { taskId: "task_1", sessionId: "s" }
  });
  assert.deepEqual(captured.__orchestration, { taskId: "task_1", sessionId: "s", subtaskId: "a" });
});

test("no __orchestration marker when not durable (off parity)", async () => {
  let captured = null;
  const worker = { send: async (_p, opts) => { captured = opts; return { status: "complete", content: "ok" }; } };
  await runDispatchLoop({
    plan: { subtasks: [st("a")] }, workerFactory: { worker: () => worker }, makeReviewer: reviewerOk,
    synthesizer: { synthesize: async () => "" }, budget: { exceeded: () => null }, maxWorkerAttempts: 1, autonomy: "gated"
  });
  assert.equal("__orchestration" in captured, false);
  assert.deepEqual(Object.keys(captured).sort(), ["autonomy", "projectRules"]);
});

function noBudget() { return { exceeded: () => null, snapshot: () => ({ tokens: 0, model_calls: 0, max_tokens: null, max_model_calls: null }) }; }
function buildOrch({ subtasks, workerFor, orchPersistence = null }) {
  return createOrchestrator({
    planner: { plan: async () => ({ task_summary: "t", done_when: "d", subtasks }), replan: async () => ({ done: true, subtasks: [] }) },
    makeWorkerFactory: () => ({ worker: (s) => workerFor(s) }),
    makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async ({ collected }) => collected.map((c) => `${c.st.id}=${c.status}`).join(",") },
    makeBudget: () => noBudget(), makeResumedBudget: () => noBudget(),
    maxSubtasks: 8, maxWorkerAttempts: 1, eventBus: { publish() {} }, makeContext: async () => null, maxRounds: 2,
    orchPersistence, pausedTurnStore: { get: () => null, delete: () => {} }, pausedTurnPersistence: { consume: async () => {} },
    env: { root: "/root", orchestrationConfig: {} }
  });
}

test("initial pause writes a durable orchestration sidecar (driveFrom, recovery on)", async () => {
  let saved = null;
  const orch = buildOrch({
    subtasks: [st("a"), st("b")],
    workerFor: (s) => (s.id === "a"
      ? { send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }), approve: async () => ({ status: "complete", content: "a" }) }
      : { send: async () => ({ status: "complete", content: "b" }) }),
    orchPersistence: { save: async (id, json) => { saved = { id, json }; }, consume: async () => {}, load: async () => null }
  });
  const p = await orch.run({ message: "m", options: { autonomy: "gated" } });
  assert.equal(p.status, "awaiting_approval");
  assert.equal(saved.id, "ap1");
  assert.equal(saved.json.pausedSubtask.id, "a");
  assert.deepEqual(saved.json.remaining.map((s) => s.id), ["b"]);
});

test("off: no durable sidecar written, C5 in-memory path unchanged", async () => {
  const orch = buildOrch({
    subtasks: [st("a")],
    workerFor: () => ({ send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }) })
    // orchPersistence omitted -> null
  });
  const p = await orch.run({ message: "m", options: { autonomy: "gated" } });
  assert.equal(p.status, "awaiting_approval");
  assert.equal(orch.hasPaused("ap1"), true);   // held in memory only (C5)
});

test("same-process resume consumes the old durable sidecar", async () => {
  const consumed = [];
  const orch = buildOrch({
    subtasks: [st("a"), st("b")],
    workerFor: (s) => (s.id === "a"
      ? { send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }), approve: async () => ({ status: "complete", content: "a" }) }
      : { send: async () => ({ status: "complete", content: "b" }) }),
    orchPersistence: { save: async () => {}, consume: async (id) => { consumed.push(id); }, load: async () => null }
  });
  await orch.run({ message: "m", options: { autonomy: "gated" } });
  const done = await orch.resume("ap1", "approve");
  assert.equal(done.status, "complete");
  assert.ok(consumed.includes("ap1"));   // old sidecar consumed on resume
});

