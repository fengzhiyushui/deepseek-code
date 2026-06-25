import test from "node:test";
import assert from "node:assert/strict";
import { runExecutorLoop } from "../../../../src/core/execution/executor-loop.js";

// 第 1 次返回畸形 tool-call,第 2 次返回干净完成
function malformedThenDone() {
  let n = 0;
  return {
    invoke: async () => {
      n += 1;
      if (n === 1) {
        return { content: "", tool_calls: [{ id: "bad", name: "read", arguments: null, arguments_parse_error: "Unexpected token" }] };
      }
      return { content: "done", tool_calls: [], usage: { total_tokens: 1 } };
    },
    calls: () => n
  };
}

test("repairs a malformed tool call then completes", async () => {
  const gw = malformedThenDone();
  const result = await runExecutorLoop({
    message: "go",
    classification: { task_type: "edit" },
    turnId: "t1",
    modelGateway: gw,
    toolSchemas: [],
    executeTool: async () => ({ status: "success", content: [] }),
    createPolicyContext: () => ({}),
    maxIterations: 5,
    maxToolCallRepairs: 1
  });
  assert.equal(result.status, "complete");
  assert.equal(result.content, "done");
  assert.equal(gw.calls(), 2); // 初次 + 1 次重试
});

test("gives up after maxToolCallRepairs and throws", async () => {
  const alwaysBad = {
    invoke: async () => ({ content: "", tool_calls: [{ id: "bad", name: "read", arguments: null, arguments_parse_error: "boom" }] })
  };
  await assert.rejects(
    () => runExecutorLoop({
      message: "go",
      classification: { task_type: "edit" },
      turnId: "t1",
      modelGateway: alwaysBad,
      toolSchemas: [],
      executeTool: async () => ({ status: "success", content: [] }),
      createPolicyContext: () => ({}),
      maxIterations: 10,
      maxToolCallRepairs: 2
    }),
    /invalid tool arguments/
  );
});

test("default (no repairs) throws immediately", async () => {
  const alwaysBad = {
    invoke: async () => ({ content: "", tool_calls: [{ id: "bad", name: "read", arguments: null, arguments_parse_error: "boom" }] })
  };
  await assert.rejects(
    () => runExecutorLoop({
      message: "go",
      classification: { task_type: "edit" },
      turnId: "t1",
      modelGateway: alwaysBad,
      toolSchemas: [],
      executeTool: async () => ({ status: "success", content: [] }),
      createPolicyContext: () => ({}),
      maxIterations: 10
    }),
    /invalid tool arguments/
  );
});
