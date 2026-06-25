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
