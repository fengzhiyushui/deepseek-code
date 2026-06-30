import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";

function mk({ crossTaskLearning, planUsed = [], presentedIds = [], procedural = [] }) {
  const calls = { retrieval: 0, consolidate: [], plannerExp: null };
  const orch = createOrchestrator({
    planner: {
      plan: async ({ experiences }) => {
        calls.plannerExp = experiences;
        return {
          task_summary: "s", done_when: "d",
          subtasks: [{ id: "st1", goal: "g", acceptance: ["a"], context_scope: {}, tool_profile: "edit", depends_on: [] }],
          used_experience_ids: planUsed
        };
      }
    },
    makeWorkerFactory: () => ({ worker: () => ({ send: async () => ({ status: "complete", content: "ok" }) }), reviewerRuntime: () => ({}) }),
    makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async ({ collected }) => `done:${collected.length}` },
    makeBudget: () => ({ exceeded: () => null }),
    maxSubtasks: 8, maxWorkerAttempts: 2, maxRounds: 2,
    crossTaskLearning,
    experienceRetrieval: { query: () => { calls.retrieval += 1; return { procedural, presentedIds, riskCues: new Set(["r"]) }; } },
    experienceConsolidator: { consolidate: async (args) => { calls.consolidate.push(args); return { written: 1 }; } },
    now: () => 1700000000000
  });
  return { orch, calls };
}

test("off: no retrieval, no consolidation, planner gets empty experiences (zero regression)", async () => {
  const { orch, calls } = mk({ crossTaskLearning: "off", procedural: [{ id: "e1", lesson: "L", tier: 1 }], presentedIds: ["e1"] });
  const r = await orch.run({ message: "m", options: {} });
  await orch.flushExperience();
  assert.equal(r.status, "complete");
  assert.equal(calls.retrieval, 0);
  assert.equal(calls.consolidate.length, 0);
  assert.deepEqual(calls.plannerExp, []);
});

test("on: retrieval feeds planner; consolidation runs with adopted = used ∩ presented", async () => {
  const { orch, calls } = mk({
    crossTaskLearning: "on",
    planUsed: ["e1", "e9"],          // e9 was never presented -> must be dropped
    presentedIds: ["e1", "e2"],
    procedural: [{ id: "e1", lesson: "L1", tier: 1 }, { id: "e2", lesson: "L2", tier: 2 }]
  });
  await orch.run({ message: "m", options: {} });
  await orch.flushExperience();
  assert.equal(calls.retrieval, 1);
  assert.equal(calls.plannerExp.length, 2);
  assert.equal(calls.consolidate.length, 1);
  assert.deepEqual(calls.consolidate[0].adoptedExperienceIds, ["e1"]);
  assert.equal(calls.consolidate[0].outcome, "complete");
  assert.equal(calls.consolidate[0].taskId, "task_" + (1700000000000).toString(36));
});

test("run() returns before consolidation completes (background)", async () => {
  let resolved = false;
  const orch = createOrchestrator({
    planner: { plan: async () => ({ task_summary: "s", done_when: "d", subtasks: [{ id: "st1", goal: "g", acceptance: ["a"], context_scope: {}, tool_profile: "edit", depends_on: [] }], used_experience_ids: [] }) },
    makeWorkerFactory: () => ({ worker: () => ({ send: async () => ({ status: "complete", content: "ok" }) }), reviewerRuntime: () => ({}) }),
    makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async () => "done" },
    makeBudget: () => ({ exceeded: () => null }),
    maxSubtasks: 8, maxWorkerAttempts: 2, maxRounds: 2,
    crossTaskLearning: "on",
    experienceRetrieval: { query: () => ({ procedural: [], presentedIds: [], riskCues: new Set() }) },
    experienceConsolidator: { consolidate: async () => { await new Promise((r) => setTimeout(r, 20)); resolved = true; return { written: 0 }; } },
    now: () => 1
  });
  await orch.run({ message: "m", options: {} });
  assert.equal(resolved, false);   // not awaited by run()
  await orch.flushExperience();
  assert.equal(resolved, true);    // flush awaits it
});
