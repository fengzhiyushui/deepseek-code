import { assembleReplyMessages } from "../../deepseek/prompt-assembler.js";
import { adaptDeepSeekToolCalls } from "./tool-call-adapter.js";
import { toolResultsToMessages } from "./tool-result-router.js";

export async function runExecutorLoop({
  message,
  classification,
  turnId,
  modelGateway,
  toolSchemas = [],
  executeTool,
  createPolicyContext,
  eventBus = null,
  signal = null,
  maxIterations = 5,
  context = null,
  options = {}
} = {}) {
  if (!modelGateway || typeof modelGateway.invoke !== "function") {
    throw new Error("modelGateway.invoke is required for executor loop");
  }
  if (typeof executeTool !== "function") throw new Error("executeTool is required");
  if (typeof createPolicyContext !== "function") throw new Error("createPolicyContext is required");

  let messages = assembleReplyMessages({
    message,
    classification,
    context,
    systemAddendum: "Use tools when needed. When tool results are sufficient, answer normally."
  });
  const toolResults = [];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    eventBus?.publish?.("model:request", { turn_id: turnId, purpose: "act", iteration });
    const modelResult = await modelGateway.invoke(messages, {
      purpose: iteration === 0 ? "plan" : "act",
      tools: toolSchemas,
      toolChoice: "auto",
      signal,
      ...options
    });
    eventBus?.publish?.("model:response", {
      turn_id: turnId,
      purpose: iteration === 0 ? "plan" : "act",
      iteration,
      content: modelResult.content || "",
      tool_call_count: modelResult.tool_calls?.length || 0,
      usage: modelResult.usage || null,
      model: modelResult.model,
      channel: modelResult.channel
    });

    const rawToolCalls = modelResult.tool_calls || [];
    if (!rawToolCalls.length) {
      return {
        status: "complete",
        content: modelResult.content || "",
        iterations: iteration + 1,
        toolResults
      };
    }

    const toolCalls = adaptDeepSeekToolCalls(rawToolCalls, { requestedByStepId: `model:${turnId}:${iteration}` });
    const iterationResults = [];
    for (const toolCall of toolCalls) {
      const policyContext = createPolicyContext({ turnId, toolCall });
      const result = await executeTool(toolCall, policyContext);
      iterationResults.push(result);
      toolResults.push(result);
      if (result.status === "approval_required") {
        return {
          status: "awaiting_approval",
          content: result.content?.[0]?.text || "Approval required",
          approval: result.metadata?.approval || null,
          toolResults,
          iterations: iteration + 1
        };
      }
    }

    messages = [
      ...messages,
      assistantToolCallMessage(modelResult, rawToolCalls),
      ...toolResultsToMessages(iterationResults)
    ];
  }

  throw new Error(`maximum tool iterations exceeded: ${maxIterations}`);
}

function assistantToolCallMessage(modelResult, rawToolCalls) {
  return {
    role: "assistant",
    content: modelResult.content || "",
    tool_calls: rawToolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.raw_arguments || JSON.stringify(call.arguments || {})
      }
    }))
  };
}
