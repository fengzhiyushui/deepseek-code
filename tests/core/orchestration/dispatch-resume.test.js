import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatchLoop, resumeDispatchLoop } from "../../../src/core/orchestration/dispatch-loop.js";

function st(id) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }; }
const reviewerPass = () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) });
const synth = { synthesize: async () => "x" };
const noBudget = { exceeded: () => null };

test("pause returns resume with worker + remaining; resume finishes round (no dup)", async () => {
  const pausedWorker = {
    send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }),
    approve: async () => ({ status: "complete", content: "did st_1" })
  };
  const okWorker = (id) => ({ send: async () => ({ status: "complete", content: `did ${id}` }) });
  const workerFactory = { worker: (s) => (s.id === "st_1" ? pausedWorker : okWorker(s.id)) };
  const plan = { subtasks: [st("st_1"), st("st_2")] };
  const r = await runDispatchLoop({ plan, workerFactory, makeReviewer: reviewerPass, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 1, autonomy: "gated" });
  assert.equal(r.status, "awaiting_approval");
  assert.equal(r.approval.id, "ap1");
  assert.deepEqual(r.collected, []);                 // nothing settled before the pause (st_1 was first)
  assert.equal(r.resume.pausedSubtask.id, "st_1");
  assert.deepEqual(r.resume.remaining.map((s) => s.id), ["st_2"]);

  const done = await resumeDispatchLoop(r.resume, "approve");
  assert.equal(done.status, "complete");
  assert.deepEqual(done.collected.map((c) => `${c.st.id}:${c.status}`), ["st_1:complete", "st_2:complete"]);
});

test("deny -> paused subtask failed, remaining still dispatched", async () => {
  const pausedWorker = { send: async () => ({ status: "awaiting_approval", approval: { id: "ap1" } }), approve: async () => ({ status: "complete", content: "x" }) };
  const workerFactory = { worker: (s) => (s.id === "st_1" ? pausedWorker : { send: async () => ({ status: "complete", content: "ok" }) }) };
  const r = await runDispatchLoop({ plan: { subtasks: [st("st_1"), st("st_2")] }, workerFactory, makeReviewer: reviewerPass, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 1, autonomy: "gated" });
  const done = await resumeDispatchLoop(r.resume, "deny");
  assert.equal(done.collected.find((c) => c.st.id === "st_1").status, "failed");
  assert.equal(done.collected.find((c) => c.st.id === "st_2").status, "complete");
});

test("settled-before-pause goes into result.collected (single source)", async () => {
  // st_1 completes; st_2 pauses -> result.collected has st_1 only; resume adds st_2
  const pausedWorker = { send: async () => ({ status: "awaiting_approval", approval: { id: "ap2" } }), approve: async () => ({ status: "complete", content: "did st_2" }) };
  const workerFactory = { worker: (s) => (s.id === "st_2" ? pausedWorker : { send: async () => ({ status: "complete", content: "did st_1" }) }) };
  const r = await runDispatchLoop({ plan: { subtasks: [st("st_1"), st("st_2")] }, workerFactory, makeReviewer: reviewerPass, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 1, autonomy: "gated" });
  assert.deepEqual(r.collected.map((c) => c.st.id), ["st_1"]);   // st_1 settled pre-pause
  const done = await resumeDispatchLoop(r.resume, "approve");
  assert.deepEqual(done.collected.map((c) => c.st.id), ["st_2"]); // resume only adds post-pause
});
