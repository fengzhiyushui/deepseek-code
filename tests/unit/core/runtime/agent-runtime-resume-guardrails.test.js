import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRuntime } from "../../../../src/core/runtime/agent-runtime.js";

// 模型每次都要求再调一次工具,以驱动多轮;send 阶段工具需审批,approve 后成功
function buildRuntime(overrides = {}) {
  let invokeCount = 0;
  let approvalConsumed = false;
  const modelGateway = {
    invoke: async () => {
      invokeCount += 1;
      return {
        content: "",
        tool_calls: [{ id: `c${invokeCount}`, name: "noop", arguments: {} }],
        usage: { total_tokens: 1 }
      };
    }
  };
  const executeTool = async (toolCall) => {
    if (!approvalConsumed) {
      approvalConsumed = true;
      return { call_id: toolCall.id, status: "approval_required", content: [{ type: "text", text: "need ok" }], metadata: { approval: { id: "appr_1" } } };
    }
    return { call_id: toolCall.id, status: "success", content: [] };
  };
  const runtime = createAgentRuntime({
    sessionId: "s1",
    modelGateway,
    executeTool,
    toolSchemas: () => [{ type: "function", function: { name: "noop" } }],
    createPolicyContext: () => ({}),
    grantApprovalForToolCall: async () => {},
    ...overrides
  });
  return { runtime, invokes: () => invokeCount };
}

test("approve() resume enforces cost budget and stops the turn", async () => {
  const { runtime } = buildRuntime({ maxModelCalls: 1 });
  const paused = await runtime.send("go", { autonomy: "gated" });
  assert.equal(paused.status, "awaiting_approval");

  const resumed = await runtime.approve("appr_1", "approve");
  assert.equal(resumed.status, "stopped"); // 预算在 resume 段生效 → 干净停止(而非裸跑/抛错)
});
