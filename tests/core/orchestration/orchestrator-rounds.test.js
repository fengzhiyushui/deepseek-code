import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";

function st(id) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }; }
const ok = (id) => ({ send: async () => ({ status: "complete", content: id }) });
const fail = () => ({ send: async () => ({ status: "failed", content: "broke" }) });

function makeOrch({ plan, replan, workerFor, maxRounds = 2 }) {
  return createOrchestrator({
    planner: { plan: async () => plan, replan },
    makeWorkerFactory: () => ({ worker: (s) => workerFor(s) }),
    makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async ({ collected }) => collected.map((c) => `${c.st.id}=${c.status}`).join(",") },
    makeBudget: () => ({ exceeded: () => null }),
    maxSubtasks: 8, maxWorkerAttempts: 1, eventBus: { publish() {} }, makeContext: async () => null,
    maxRounds
  });
}

test("failure -> replan corrective -> 2nd round completes (outcome partial)", async () => {
  const orch = makeOrch({
    plan: { task_summary: "t", done_when: "d", subtasks: [st("a")] },
    replan: async () => ({ done: false, subtasks: [{ id: "a2", goal: "fix a", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [], corrective_for: "a" }] }),
    workerFor: (s) => (s.id === "a" ? fail() : ok(s.id)), maxRounds: 2
  });
  const r = await orch.run({ message: "m", options: {} });
  assert.match(r.content, /a=failed/);
  assert.match(r.content, /a2=complete/);
  assert.equal(r.outcome, "partial");
});

test("replan done -> single round; outcome complete", async () => {
  const orch = makeOrch({ plan: { task_summary: "t", done_when: "d", subtasks: [st("a")] }, replan: async () => ({ done: true, subtasks: [] }), workerFor: ok, maxRounds: 2 });
  const r = await orch.run({ message: "m", options: {} });
  assert.equal(r.outcome, "complete");
  assert.match(r.content, /a=complete/);
});

test("maxRounds=1 -> exactly one dispatch, no replan (zero regression)", async () => {
  let replanCalls = 0;
  const orch = makeOrch({ plan: { task_summary: "t", done_when: "d", subtasks: [st("a")] }, replan: async () => { replanCalls += 1; return { done: false, subtasks: [st("b")] }; }, workerFor: ok, maxRounds: 1 });
  const r = await orch.run({ message: "m", options: {} });
  assert.equal(replanCalls, 0);          // maxRounds=1 -> never replan
  assert.match(r.content, /a=complete/);
  assert.equal(/b=/.test(r.content), false);
});

test("no-progress guard: round completed nothing + replan all stale fingerprints -> stop", async () => {
  // round 1: a fails (zero completed). replan returns a same-fingerprint retry (renamed id) -> stale -> stop.
  const orch = makeOrch({
    plan: { task_summary: "t", done_when: "d", subtasks: [st("a")] },
    replan: async () => ({ done: false, subtasks: [{ id: "a_again", goal: "a", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }] }),
    workerFor: fail, maxRounds: 5
  });
  const r = await orch.run({ message: "m", options: {} });
  assert.match(r.content, /a=failed/);
  assert.equal(/a_again/.test(r.content), false);   // never dispatched (no progress)
  assert.equal(r.outcome, "partial");
});

test("no replan method -> single round (zero regression)", async () => {
  const orch = makeOrch({ plan: { task_summary: "t", done_when: "d", subtasks: [st("a")] }, replan: undefined, workerFor: ok, maxRounds: 3 });
  const r = await orch.run({ message: "m", options: {} });
  assert.match(r.content, /a=complete/);
  assert.equal(r.outcome, "complete");
});
