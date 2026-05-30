import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../../../../src/shared/event-bus.js";
import { runExecutorLoop, resumeExecutorLoop } from "../../../../src/core/execution/executor-loop.js";

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

test("executor loop returns resume_state when approval is required", async () => {
  const result = await runExecutorLoop({
    message: "edit file",
    classification: { task_type: "edit" },
    turnId: "turn_approval",
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
      metadata: { approval: { id: "approval_1", summary: "edit requires approval" } }
    }),
    createPolicyContext: () => ({ autonomy: "supervised" })
  });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.resume_state.pending_tool_call.name, "edit");
  assert.equal(result.resume_state.iteration, 0);
  assert.equal(result.resume_state.tool_results.length, 0);
});

test("resumeExecutorLoop executes pending and remaining tools then finishes", async () => {
  const modelCalls = [];
  const executed = [];
  const modelGateway = {
    invoke: async (messages) => {
      modelCalls.push(messages);
      return { content: "done after approval", tool_calls: [] };
    }
  };
  const resumeState = {
    turn_id: "turn_resume",
    message: "edit and read",
    classification: { task_type: "edit" },
    messages: [{ role: "user", content: "edit and read" }],
    model_result: { content: "", tool_calls: [
      { id: "call_edit", name: "edit", arguments: { diff: "d" } },
      { id: "call_read", name: "read", arguments: { path: "a.txt" } }
    ] },
    raw_tool_calls: [
      { id: "call_edit", name: "edit", arguments: { diff: "d" } },
      { id: "call_read", name: "read", arguments: { path: "a.txt" } }
    ],
    pending_tool_call: { id: "call_edit", name: "edit", params: { diff: "d" }, requested_by_step_id: "model:turn_resume:0" },
    remaining_tool_calls: [{ id: "call_read", name: "read", params: { path: "a.txt" }, requested_by_step_id: "model:turn_resume:0" }],
    iteration: 0,
    tool_results: [],
    tool_schemas: [],
    max_iterations: 5,
    options: {}
  };

  const result = await resumeExecutorLoop({
    resumeState,
    modelGateway,
    executeTool: async (toolCall) => {
      executed.push(toolCall.name);
      return { call_id: toolCall.id, status: "success", content: [{ type: "text", text: `${toolCall.name} ok` }], metadata: {} };
    },
    createPolicyContext: () => ({ autonomy: "supervised" })
  });

  assert.equal(result.status, "complete");
  assert.equal(result.content, "done after approval");
  assert.deepEqual(executed, ["edit", "read"]);
  assert.equal(modelCalls.length, 1);
  assert.ok(modelCalls[0].some((message) => message.role === "tool"));
});

test("resumeExecutorLoop can pause again on a remaining tool approval", async () => {
  const resumeState = {
    turn_id: "turn_resume_again",
    message: "edit then shell",
    classification: { task_type: "edit" },
    messages: [{ role: "user", content: "edit then shell" }],
    model_result: { content: "", tool_calls: [
      { id: "call_edit", name: "edit", arguments: { diff: "d" } },
      { id: "call_shell", name: "shell", arguments: { argv: ["npm", "test"] } }
    ] },
    raw_tool_calls: [
      { id: "call_edit", name: "edit", arguments: { diff: "d" } },
      { id: "call_shell", name: "shell", arguments: { argv: ["npm", "test"] } }
    ],
    pending_tool_call: { id: "call_edit", name: "edit", params: { diff: "d" }, requested_by_step_id: "model:turn_resume_again:0" },
    remaining_tool_calls: [{ id: "call_shell", name: "shell", params: { argv: ["npm", "test"] }, requested_by_step_id: "model:turn_resume_again:0" }],
    iteration: 0,
    tool_results: [],
    tool_schemas: [],
    max_iterations: 5,
    options: {}
  };

  const result = await resumeExecutorLoop({
    resumeState,
    modelGateway: { invoke: async () => ({ content: "should not call model", tool_calls: [] }) },
    executeTool: async (toolCall) => {
      if (toolCall.name === "shell") {
        return {
          call_id: toolCall.id,
          status: "approval_required",
          content: [{ type: "text", text: "shell requires approval" }],
          metadata: { approval: { id: "approval_shell" } }
        };
      }
      return { call_id: toolCall.id, status: "success", content: [{ type: "text", text: "edit ok" }] };
    },
    createPolicyContext: () => ({ autonomy: "supervised" })
  });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.approval.id, "approval_shell");
  assert.equal(result.resume_state.pending_tool_call.name, "shell");
  assert.equal(result.resume_state.tool_results.length, 1);
});
