import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRuntime } from "../../../../src/core/runtime/agent-runtime.js";

// gateway 永远要求继续调工具,带 usage → 必须靠 budget 截停
const gateway = {
  invoke: async () => ({
    content: "",
    tool_calls: [{ id: "c1", name: "noop", arguments: {} }],
    usage: { total_tokens: 50 }
  })
};
const executeTool = async () => ({ call_id: "c1", status: "success", content: [], metadata: {} });

test("runtime ends an edit turn cleanly when maxTurnTokens is exceeded", async () => {
  const runtime = createAgentRuntime({
    sessionId: "s1",
    modelGateway: gateway,
    executeTool,
    toolSchemas: () => [{ type: "function", function: { name: "noop" } }],
    createPolicyContext: () => ({}),
    maxToolIterations: 50,
    maxTurnTokens: 120
  });
  const r = await runtime.send("update the file", { autonomy: "auto" });
  assert.equal(r.status, "stopped");
  assert.equal(r.state, "idle");
  assert.match(r.content, /budget/i);
});

test("tokens consumed before an approval pause carry into the resumed turn (budget not reset)", async () => {
  let invokeCount = 0;
  let approvalConsumed = false;
  const modelGateway = {
    invoke: async () => {
      invokeCount += 1;
      return {
        content: "",
        tool_calls: [{ id: `c${invokeCount}`, name: "noop", arguments: {} }],
        usage: { total_tokens: 80 }
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
    maxTurnTokens: 80 // 恰好一次调用(80)即到顶
  });

  const paused = await runtime.send("go", { autonomy: "gated" });
  assert.equal(paused.status, "awaiting_approval");
  assert.equal(invokeCount, 1);

  const resumed = await runtime.approve("appr_1", "approve");
  assert.equal(resumed.status, "stopped");
  assert.equal(invokeCount, 1); // 暂停前已耗满 → 续跑不再调模型,预算未重置
});
