import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrchestrator } from "../../../src/core/orchestration/orchestrator.js";

function st(id) { return { id, goal: id, acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }; }

function deps(plan) {
  const events = [];
  return {
    events,
    orch: createOrchestrator({
      planner: { plan: async () => plan },
      makeWorkerFactory: () => ({ worker: () => ({ send: async () => ({ status: "complete", content: "ok" }) }), reviewerRuntime: () => ({}) }),
      makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
      synthesizer: { synthesize: async ({ collected }) => `done:${collected.length}` },
      makeBudget: () => ({ exceeded: () => null, recordModelResult: () => {} }),
      maxSubtasks: 8,
      maxWorkerAttempts: 2,
      eventBus: { publish: (t, d) => events.push([t, d]) },
      makeContext: async () => null
    })
  };
}

test("run plans, dispatches, synthesizes, emits events", async () => {
  const { orch, events } = deps({ task_summary: "x", done_when: "y", subtasks: [st("st_1"), st("st_2")] });
  const r = await orch.run({ message: "do stuff", options: {}, routing: { signals: [] } });
  assert.equal(r.status, "complete");
  assert.equal(r.content, "done:2");
  assert.ok(events.some(([t]) => t === "orchestration:planned"));
  assert.ok(events.some(([t]) => t === "orchestration:completed"));
});

test("truncates subtasks beyond maxSubtasks", async () => {
  const many = Array.from({ length: 12 }, (_, i) => st(`st_${i}`));
  const events = [];
  const orch3 = createOrchestrator({
    planner: { plan: async () => ({ task_summary: "x", done_when: "y", subtasks: many }) },
    makeWorkerFactory: () => ({ worker: () => ({ send: async () => ({ status: "complete", content: "ok" }) }) }),
    makeReviewerFor: () => ({ review: async () => ({ pass: true, severity: "warn", reasons: [], checked: [] }) }),
    synthesizer: { synthesize: async ({ collected }) => `done:${collected.length}` },
    makeBudget: () => ({ exceeded: () => null }),
    maxSubtasks: 3, maxWorkerAttempts: 1,
    eventBus: { publish: (t, d) => events.push([t, d]) },
    makeContext: async () => null
  });
  const r = await orch3.run({ message: "z", options: {}, routing: { signals: [] } });
  assert.equal(r.content, "done:3");
});
