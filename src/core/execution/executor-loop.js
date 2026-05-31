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
    const next = await continueToolIteration({
      turnId,
      message,
      classification,
      messages,
      modelResult,
      rawToolCalls,
      toolCalls,
      iteration,
      toolResults,
      toolSchemas,
      maxIterations,
      options,
      context,
      executeTool,
      createPolicyContext
    });
    if (next.status === "awaiting_approval") return next;
    messages = [
      ...messages,
      assistantToolCallMessage(modelResult, rawToolCalls),
      ...toolResultsToMessages(next.iterationResults)
    ];
  }

  throw new Error(`maximum tool iterations exceeded: ${maxIterations}`);
}

async function continueToolIteration({
  turnId,
  message,
  classification,
  messages,
  modelResult,
  rawToolCalls,
  toolCalls,
  iteration,
  toolResults,
  toolSchemas,
  maxIterations,
  options,
  context,
  executeTool,
  createPolicyContext
}) {
  const iterationResults = [];
  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
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
        iterations: iteration + 1,
        resume_state: {
          turn_id: turnId,
          message,
          classification,
          messages,
          model_result: modelResult,
          raw_tool_calls: rawToolCalls,
          pending_tool_call: toolCall,
          remaining_tool_calls: toolCalls.slice(index + 1),
          iteration,
          tool_results: iterationResults.slice(0, -1),
          tool_schemas: toolSchemas,
          max_iterations: maxIterations,
          options,
          context
        }
      };
    }
  }
  return { status: "continued", iterationResults };
}

export async function resumeExecutorLoop({
  resumeState,
  modelGateway,
  executeTool,
  createPolicyContext,
  eventBus = null,
  signal = null
} = {}) {
  if (!resumeState) throw new Error("resumeState is required");
  if (!modelGateway || typeof modelGateway.invoke !== "function") {
    throw new Error("modelGateway.invoke is required for executor loop resume");
  }
  if (typeof executeTool !== "function") throw new Error("executeTool is required");
  if (typeof createPolicyContext !== "function") throw new Error("createPolicyContext is required");

  const iterationResults = [];
  const toolResults = [...(resumeState.tool_results || [])];
  const pendingAndRemaining = [
    resumeState.pending_tool_call,
    ...(resumeState.remaining_tool_calls || [])
  ].filter(Boolean);

  for (let index = 0; index < pendingAndRemaining.length; index += 1) {
    const toolCall = pendingAndRemaining[index];
    const policyContext = createPolicyContext({ turnId: resumeState.turn_id, toolCall, phase: "resume" });
    const result = await executeTool(toolCall, policyContext);
    iterationResults.push(result);
    toolResults.push(result);
    if (result.status === "approval_required") {
      return {
        status: "awaiting_approval",
        content: result.content?.[0]?.text || "Approval required",
        approval: result.metadata?.approval || null,
        toolResults,
        iterations: resumeState.iteration + 1,
        resume_state: {
          turn_id: resumeState.turn_id,
          message: resumeState.message,
          classification: resumeState.classification,
          messages: resumeState.messages,
          model_result: resumeState.model_result,
          raw_tool_calls: resumeState.raw_tool_calls,
          pending_tool_call: toolCall,
          remaining_tool_calls: pendingAndRemaining.slice(index + 1),
          iteration: resumeState.iteration,
          tool_results: toolResults.slice(0, -1),
          tool_schemas: resumeState.tool_schemas || [],
          max_iterations: resumeState.max_iterations || 5,
          options: resumeState.options || {},
          context: resumeState.context || null
        }
      };
    }
  }

  let messages = [
    ...resumeState.messages,
    assistantToolCallMessage(resumeState.model_result, resumeState.raw_tool_calls),
    ...toolResultsToMessages([...resumeState.tool_results, ...iterationResults])
  ];

  for (let iteration = resumeState.iteration + 1; iteration < (resumeState.max_iterations || 5); iteration += 1) {
    eventBus?.publish?.("model:request", { turn_id: resumeState.turn_id, purpose: "act", iteration });
    const modelResult = await modelGateway.invoke(messages, {
      purpose: "act",
      tools: resumeState.tool_schemas || [],
      toolChoice: "auto",
      signal,
      ...(resumeState.options || {})
    });
    eventBus?.publish?.("model:response", {
      turn_id: resumeState.turn_id,
      purpose: "act",
      iteration,
      content: modelResult.content || "",
      tool_call_count: modelResult.tool_calls?.length || 0,
      usage: modelResult.usage || null,
      model: modelResult.model,
      channel: modelResult.channel
    });
    const rawToolCalls = modelResult.tool_calls || [];
    if (!rawToolCalls.length) {
      return { status: "complete", content: modelResult.content || "", iterations: iteration + 1, toolResults };
    }
    const toolCalls = adaptDeepSeekToolCalls(rawToolCalls, { requestedByStepId: `model:${resumeState.turn_id}:${iteration}` });
    const next = await continueToolIteration({
      turnId: resumeState.turn_id,
      message: resumeState.message,
      classification: resumeState.classification,
      messages,
      modelResult,
      rawToolCalls,
      toolCalls,
      iteration,
      toolResults,
      toolSchemas: resumeState.tool_schemas || [],
      maxIterations: resumeState.max_iterations || 5,
      options: resumeState.options || {},
      context: resumeState.context || null,
      executeTool,
      createPolicyContext
    });
    if (next.status === "awaiting_approval") return next;
    messages = [...messages, assistantToolCallMessage(modelResult, rawToolCalls), ...toolResultsToMessages(next.iterationResults)];
  }

  throw new Error(`maximum tool iterations exceeded: ${resumeState.max_iterations || 5}`);
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
