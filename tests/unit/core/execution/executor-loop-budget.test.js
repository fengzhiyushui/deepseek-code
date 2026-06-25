import test from "node:test";
import assert from "node:assert/strict";
import { runExecutorLoop } from "../../../../src/core/execution/executor-loop.js";
import { createCostBudget } from "../../../../src/core/runtime/cost-budget.js";

// 假 gateway:每轮都要求再调一次工具,从不自然结束 → 必须靠 budget 截停
// tool_calls 用 gateway 归一化后的形态 { id, name, arguments }
function toolLoopingGateway() {
  return {
    invoke: async () => ({
      content: "",
      tool_calls: [{ id: "c1", name: "noop", arguments: {} }],
      usage: { total_tokens: 40 }
    })
  };
}
const noopExecute = async () => ({ call_id: "c1", status: "success", content: [], metadata: {} });
const policy = () => ({});

test("budget stops the loop with BUDGET_EXCEEDED", async () => {
  const budget = createCostBudget({ maxTokens: 100 }); // 第 3 轮前累计 80→120 触发
  await assert.rejects(
    () => runExecutorLoop({
      message: "go",
      classification: { task_type: "edit" },
      turnId: "t1",
      modelGateway: toolLoopingGateway(),
      toolSchemas: [],
      executeTool: noopExecute,
      createPolicyContext: policy,
      maxIterations: 50,
      budget
    }),
    (e) => e.code === "BUDGET_EXCEEDED"
  );
  assert.ok(budget.snapshot().tokens >= 100);
});

test("no budget keeps maxIterations behavior", async () => {
  await assert.rejects(
    () => runExecutorLoop({
      message: "go",
      classification: { task_type: "edit" },
      turnId: "t1",
      modelGateway: toolLoopingGateway(),
      toolSchemas: [],
      executeTool: noopExecute,
      createPolicyContext: policy,
      maxIterations: 2
    }),
    /maximum tool iterations exceeded/
  );
});
