import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";
import { createCostBudget } from "../../../src/core/runtime/cost-budget.js";

function build() {
  return createOrchestrator({
    planner: { plan: async () => ({ subtasks: [] }) },
    makeWorkerFactory: () => ({ worker: () => ({}) }),
    makeReviewerFor: () => ({ review: async () => ({}) }),
    synthesizer: { synthesize: async () => "" },
    makeBudget: () => createCostBudget({ maxTokens: 100, maxModelCalls: 10 }),
    makeResumedBudget: (s) => createCostBudget({ maxTokens: s.maxTokens, maxModelCalls: s.maxModelCalls, initialTokens: s.initialTokens, initialModelCalls: s.initialModelCalls }),
    maxSubtasks: 8, maxWorkerAttempts: 1, eventBus: { publish() {} }, makeContext: async () => null, maxRounds: 2,
    env: { root: "/root", orchestrationConfig: { maxRounds: 2 } }
  });
}

function fakeState() {
  const budget = createCostBudget({ maxTokens: 100, maxModelCalls: 10 });
  budget.recordModelResult({ usage: { total_tokens: 40 } }); // spent 40 tokens / 1 call
  return {
    message: "m", done_when: "d", options: { autonomy: "gated", sessionId: "s" },
    plan: { subtasks: [{ id: "a", goal: "g", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }] },
    round: 1, allCollected: [], seenSubtaskIds: new Set(["a"]), seenFp: new Set(["fp"]),
    budget, adoptedExperienceIds: [], riskCues: new Set(), taskId: "task_1", sessionId: "s",
    env: { root: "/root", orchestrationConfig: { maxRounds: 2 } }
  };
}

test("serializeState → deserializeState rebuilds a live budget that CONTINUES from spend (CST-8)", () => {
  const orch = build();
  const json = orch.serializeState(fakeState(), {
    approvalId: "ap1",
    pausedSubtask: { id: "b", goal: "gb", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] },
    remaining: []
  });
  assert.equal(json.budget.spentTokens, 40);
  assert.equal(json.budget.quotaTokens, 100);

  const state = orch.deserializeState(JSON.parse(JSON.stringify(json)));
  assert.equal(state.budget.snapshot().tokens, 40);            // continues, not reset
  assert.equal(state.budget.exceeded(), null);
  state.budget.recordModelResult({ usage: { total_tokens: 65 } }); // 40 + 65 = 105 >= 100
  assert.equal(state.budget.exceeded().reason, "max_tokens");
  assert.ok(state.seenSubtaskIds.has("a"));
  assert.equal(state.taskId, "task_1");
  assert.equal(state.pausedSubtask.id, "b");
});
