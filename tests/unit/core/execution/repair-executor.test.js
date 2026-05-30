import test from "node:test";
import assert from "node:assert/strict";
import { runRepairExecutor } from "../../../../src/core/execution/repair-executor.js";

test("repair executor invokes repair model and executes tool calls through executeTool", async () => {
  const executed = [];
  const modelCalls = [];
  const result = await runRepairExecutor({
    turnId: "turn_repair",
    messages: [{ role: "user", content: "repair" }],
    modelGateway: {
      invoke: async (messages, options) => {
        modelCalls.push({ messages, options });
        return {
          content: "",
          tool_calls: [{ id: "call_edit", name: "edit", arguments: { diff: "d" } }]
        };
      }
    },
    toolSchemas: [{ type: "function", function: { name: "edit" } }],
    executeTool: async (toolCall) => {
      executed.push(toolCall);
      return { call_id: toolCall.id, status: "success", content: [{ type: "text", text: "applied" }], metadata: { change_id: "chg_1" } };
    },
    createPolicyContext: ({ phase }) => ({ autonomy: "gated", phase })
  });

  assert.equal(result.status, "complete");
  assert.equal(modelCalls[0].options.purpose, "repair");
  assert.equal(executed[0].name, "edit");
  assert.equal(result.toolResults.length, 1);
});

test("repair executor returns awaiting_approval with V2-7 resume_state", async () => {
  const result = await runRepairExecutor({
    turnId: "turn_repair_approval",
    messages: [{ role: "user", content: "repair" }],
    modelGateway: {
      invoke: async () => ({
        content: "",
        tool_calls: [
          { id: "call_shell", name: "shell", arguments: { argv: ["npm", "test"] } },
          { id: "call_edit", name: "edit", arguments: { diff: "d" } }
        ]
      })
    },
    toolSchemas: [],
    executeTool: async (toolCall) => ({
      call_id: toolCall.id,
      status: "approval_required",
      content: [{ type: "text", text: "needs approval" }],
      metadata: { approval: { id: "approval_repair" } }
    }),
    createPolicyContext: () => ({ autonomy: "supervised" })
  });

  assert.equal(result.status, "awaiting_approval");
  assert.equal(result.approval.id, "approval_repair");
  assert.equal(result.resume_state.pending_tool_call.name, "shell");
  assert.equal(result.resume_state.turn_id, "turn_repair_approval");
  assert.equal(result.resume_state.options.purpose, "repair");
});

test("repair executor returns final content when model has no tool calls", async () => {
  const result = await runRepairExecutor({
    turnId: "turn_repair_final",
    messages: [{ role: "user", content: "repair" }],
    modelGateway: {
      invoke: async () => ({ content: "cannot repair", tool_calls: [] })
    },
    executeTool: async () => { throw new Error("should not execute tools"); },
    createPolicyContext: () => ({ autonomy: "gated" })
  });

  assert.equal(result.status, "complete");
  assert.equal(result.content, "cannot repair");
  assert.deepEqual(result.toolResults, []);
});
