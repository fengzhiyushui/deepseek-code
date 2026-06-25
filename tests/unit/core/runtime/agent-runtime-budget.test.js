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

test("runtime stops an edit turn when maxTurnTokens is exceeded", async () => {
  const runtime = createAgentRuntime({
    sessionId: "s1",
    modelGateway: gateway,
    executeTool,
    toolSchemas: () => [{ type: "function", function: { name: "noop" } }],
    createPolicyContext: () => ({}),
    maxToolIterations: 50,
    maxTurnTokens: 120
  });
  await assert.rejects(
    () => runtime.send("update the file", { autonomy: "auto" }),
    (e) => e.code === "BUDGET_EXCEEDED" || /cost budget exceeded/.test(e.message)
  );
});
