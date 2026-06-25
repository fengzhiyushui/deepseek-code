import test from "node:test";
import assert from "node:assert/strict";
import { runExecutorLoop } from "../../../../src/core/execution/executor-loop.js";

test("runExecutorLoop forwards modelTimeoutMs as invoke timeoutMs", async () => {
  let seen = null;
  const gateway = {
    invoke: async (_messages, opts) => {
      seen = opts.timeoutMs;
      return { content: "done", tool_calls: [], usage: { total_tokens: 1 } };
    }
  };
  const result = await runExecutorLoop({
    message: "hi",
    classification: { task_type: "edit" },
    turnId: "t1",
    modelGateway: gateway,
    toolSchemas: [],
    executeTool: async () => ({ status: "success", content: [] }),
    createPolicyContext: () => ({}),
    maxIterations: 3,
    modelTimeoutMs: 1234
  });
  assert.equal(result.status, "complete");
  assert.equal(seen, 1234);
});

test("no modelTimeoutMs leaves timeoutMs undefined", async () => {
  let seen = "unset";
  const gateway = {
    invoke: async (_messages, opts) => {
      seen = opts.timeoutMs;
      return { content: "done", tool_calls: [], usage: { total_tokens: 1 } };
    }
  };
  await runExecutorLoop({
    message: "hi",
    classification: { task_type: "edit" },
    turnId: "t1",
    modelGateway: gateway,
    toolSchemas: [],
    executeTool: async () => ({ status: "success", content: [] }),
    createPolicyContext: () => ({}),
    maxIterations: 3
  });
  assert.equal(seen, undefined);
});
