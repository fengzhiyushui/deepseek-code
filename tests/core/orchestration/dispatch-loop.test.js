import { test } from "node:test";
import assert from "node:assert/strict";
import { runDispatchLoop } from "../../../src/core/orchestration/dispatch-loop.js";

function st(id, deps = []) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: deps }; }
const noBudget = { exceeded: () => null };
const passReviewer = () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) });
const okWorker = (content) => ({ send: async () => ({ status: "complete", content }) });
const synth = { synthesize: async ({ collected }) => `synth:${collected.map((c) => `${c.st.id}=${c.status}`).join(",")}` };

test("runs subtasks in topo order; all pass -> complete", async () => {
  const order = [];
  const wf = { worker: (s) => { order.push(s.id); return okWorker(`out:${s.id}`); } };
  const plan = { subtasks: [st("st_2", ["st_1"]), st("st_1")] };
  const r = await runDispatchLoop({ plan, workerFactory: wf, makeReviewer: passReviewer, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 2, autonomy: "auto" });
  assert.deepEqual(order, ["st_1", "st_2"]);
  assert.equal(r.status, "complete");
  assert.match(r.content, /st_1=complete,st_2=complete/);
});

test("reviewer reject -> bounded retry then mark failed", async () => {
  let calls = 0;
  const wf = { worker: () => ({ send: async () => { calls += 1; return { status: "complete", content: "x" }; } }) };
  const rejectReviewer = () => ({ review: async () => ({ pass: false, severity: "block", reasons: ["nope"], checked: [] }) });
  const plan = { subtasks: [st("st_1")] };
  const r = await runDispatchLoop({ plan, workerFactory: wf, makeReviewer: rejectReviewer, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 2, autonomy: "auto" });
  assert.equal(calls, 2);                       // tried maxWorkerAttempts times
  assert.match(r.content, /st_1=failed/);
});

test("self-audit non-complete -> retry with feedback", async () => {
  let n = 0;
  const wf = { worker: () => ({ send: async () => (n++ === 0 ? { status: "failed", content: "broke" } : { status: "complete", content: "ok" }) }) };
  const plan = { subtasks: [st("st_1")] };
  const r = await runDispatchLoop({ plan, workerFactory: wf, makeReviewer: passReviewer, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 3, autonomy: "auto" });
  assert.match(r.content, /st_1=complete/);
  assert.equal(n, 2);
});

test("budget exceeded -> partial complete, no throw", async () => {
  const wf = { worker: () => okWorker("x") };
  let checks = 0;
  const budget = { exceeded: () => (++checks >= 2 ? { reason: "max_model_calls" } : null) };
  const plan = { subtasks: [st("st_1"), st("st_2"), st("st_3")] };
  const r = await runDispatchLoop({ plan, workerFactory: wf, makeReviewer: passReviewer, synthesizer: synth, budget, maxWorkerAttempts: 1, autonomy: "auto" });
  assert.equal(r.status, "complete");           // graceful, partial
  assert.match(r.content, /st_1=complete/);
});

test("worker awaiting_approval -> surfaced, loop stops", async () => {
  const wf = { worker: () => ({ send: async () => ({ status: "awaiting_approval", approval: { id: "ap_1" } }) }) };
  const plan = { subtasks: [st("st_1")] };
  const r = await runDispatchLoop({ plan, workerFactory: wf, makeReviewer: passReviewer, synthesizer: synth, budget: noBudget, maxWorkerAttempts: 1, autonomy: "gated" });
  assert.equal(r.status, "awaiting_approval");
  assert.equal(r.approval.id, "ap_1");
});
