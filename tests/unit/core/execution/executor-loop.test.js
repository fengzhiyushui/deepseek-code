import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../../src/shared/event-bus.js";
import { runExecutorLoop } from "../../../../src/core/execution/executor-loop.js";

test("executor loop executes tool calls and feeds results back to model", async () => {
  const calls = [];
  const executed = [];
  const modelGateway = {
    invoke: async (messages, options) => {
      calls.push({ messages, options });
      if (calls.length === 1) {
        return {
          content: "",
          tool_calls: [{ id: "call_read", name: "read", arguments: { path: "README.md" } }]
        };
      }
      return { content: "Read result handled", tool_calls: [] };
    }
  };

  const result = await runExecutorLoop({
    message: "read README",
    classification: { task_type: "diagnostic" },
    turnId: "turn_1",
    modelGateway,
    toolSchemas: [{ type: "function", function: { name: "read" } }],
    executeTool: async (toolCall) => {
      executed.push(toolCall);
      return { call_id: toolCall.id, status: "success", content: [{ type: "text", text: "README content" }], metadata: { path: "README.md" } };
    },
    createPolicyContext: () => ({ autonomy: "gated" })
  });

  assert.equal(result.status, "complete");
  assert.equal(result.content, "Read result handled");
  assert.equal(executed[0].name, "read");
  assert.equal(calls.length, 2);
  assert.ok(calls[1].messages.some((entry) => entry.role === "tool"));
});

test("executor loop stops on approval_required", async () => {
  const result = await runExecutorLoop({
    message: "edit file",
    classification: { task_type: "edit" },
    turnId: "turn_1",
    modelGateway: {
      invoke: async () => ({
        content: "",
        tool_calls: [{ id: "call_edit", name: "edit", arguments: { diff: "--- a/a.txt\n+++ b/a.txt" } }]
      })
    },
    toolSchemas: [],
    executeTool: async (toolCall) => ({
      call_id: toolCall.id,
      status: "approval_required",
      content: [{ type: "text", text: "edit requires approval" }],
      metadata: { approval: { id: "approval_1" } }
    }),
    createPolicyContext: () => ({ autonomy: "supervised" })
  });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.approval.id, "approval_1");
});

test("executor loop enforces max iterations", async () => {
  await assert.rejects(
    () => runExecutorLoop({
      message: "loop",
      classification: { task_type: "general" },
      turnId: "turn_1",
      maxIterations: 2,
      modelGateway: {
        invoke: async () => ({
          content: "",
          tool_calls: [{ id: `call_${Date.now()}`, name: "read", arguments: { path: "README.md" } }]
        })
      },
      toolSchemas: [],
      executeTool: async (toolCall) => ({ call_id: toolCall.id, status: "success", content: [{ type: "text", text: "ok" }] }),
      createPolicyContext: () => ({ autonomy: "gated" })
    }),
    /maximum tool iterations exceeded/
  );
});

test("executor loop reports malformed tool arguments", async () => {
  await assert.rejects(
    () => runExecutorLoop({
      message: "bad tool",
      classification: { task_type: "general" },
      turnId: "turn_1",
      modelGateway: {
        invoke: async () => ({
          content: "",
          tool_calls: [{ id: "bad", name: "read", arguments: null, arguments_parse_error: "Unexpected token" }]
        })
      },
      toolSchemas: [],
      executeTool: async () => { throw new Error("should not execute"); },
      createPolicyContext: () => ({ autonomy: "gated" })
    }),
    /invalid tool arguments/
  );
});
