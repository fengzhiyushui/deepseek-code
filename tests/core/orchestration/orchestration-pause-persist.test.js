import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatchLoop } from "../../../src/core/orchestration/dispatch-loop.js";

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
