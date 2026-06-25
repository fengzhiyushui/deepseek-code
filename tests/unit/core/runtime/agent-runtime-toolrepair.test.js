import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRuntime } from "../../../../src/core/runtime/agent-runtime.js";

function malformedThenDone() {
  let n = 0;
  return {
    invoke: async () => {
      n += 1;
      if (n === 1) return { content: "", tool_calls: [{ id: "bad", name: "noop", arguments: null, arguments_parse_error: "bad" }] };
      return { content: "done", tool_calls: [], usage: { total_tokens: 1 } };
    }
  };
}

test("runtime repairs a malformed tool call when maxToolCallRepairs > 0", async () => {
  const runtime = createAgentRuntime({
    sessionId: "s1",
    modelGateway: malformedThenDone(),
    executeTool: async () => ({ status: "success", content: [] }),
    toolSchemas: () => [{ type: "function", function: { name: "noop" } }],
    createPolicyContext: () => ({}),
    maxToolCallRepairs: 1
  });
  const r = await runtime.send("do it", { autonomy: "auto" });
  assert.equal(r.status, "complete");
  assert.equal(r.content, "done");
});
