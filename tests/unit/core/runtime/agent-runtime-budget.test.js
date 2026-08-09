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

// repair 阶段此前完全不计入每回合预算:runRepairLoop 参数表里没有 budget,
// repair-executor 却实打实调 modelGateway.invoke —— maxTurnTokens 在最容易
// 失控的路径上失效。
test("repair-phase model calls count against the turn budget", async () => {
  let invokeCount = 0;
  const events = [];
  const modelGateway = {
    invoke: async () => {
      invokeCount += 1;
      // 第 1 次:发起一个编辑工具调用;第 2 次起:不再要工具 → 工具循环正常结束
      const tool_calls = invokeCount === 1
        ? [{ id: "c1", name: "edit", arguments: {} }]
        : [];
      return { content: "", tool_calls, usage: { total_tokens: 50 } };
    }
  };
  const executeTool = async (toolCall) => {
    // 验证器跑的 test 工具:退出码非 0 → verification failed → 进 repair
    if (toolCall.name === "test") {
      return { call_id: toolCall.id, status: "success", content: [{ type: "text", text: "1 failing" }], metadata: { exit_code: 1 } };
    }
    // 编辑工具:带 change_id 才会触发验证
    return { call_id: toolCall.id, status: "success", content: [], metadata: { change_id: "chg_1" } };
  };

  const runtime = createAgentRuntime({
    sessionId: "s1",
    modelGateway,
    executeTool,
    toolSchemas: () => [{ type: "function", function: { name: "edit" } }],
    createPolicyContext: () => ({}),
    eventBus: { publish: (type) => events.push(type) },
    maxTurnTokens: 100 // 两次调用(50+50)即到顶
  });

  const r = await runtime.send("改一下然后跑测试", { autonomy: "auto" });

  // 前置断言:确实走到了 repair —— 否则下面的计数断言会假绿
  assert.ok(events.includes("repair:started"), "本用例必须真的进入 repair 阶段");
  assert.equal(invokeCount, 2, "预算已耗尽,repair 不应再发起模型调用");
  assert.equal(r.status, "stopped");
});
