import { createToolCall } from "../protocol/index.js";

export function shouldVerifyToolResults(toolResults = []) {
  return toolResults.some((result) => result.status === "success" && result.metadata?.change_id);
}

export async function runVerifier({
  turnId,
  toolResults = [],
  executeTool,
  createPolicyContext,
  eventBus = null
} = {}) {
  if (!shouldVerifyToolResults(toolResults)) {
    const skipped = { status: "skipped", reason: "no edit results" };
    eventBus?.publish?.("verification:result", { turn_id: turnId, result: skipped });
    return skipped;
  }
  const call = createToolCall({
    name: "test",
    params: { detect: true },
    source: "runtime",
    requestedByStepId: `verify:${turnId}`
  });
  const result = await executeTool(call, createPolicyContext({ turnId, toolCall: call, phase: "verify" }));
  const verification = {
    status: result.status === "success" ? "passed" : result.status,
    tool_result: result,
    reason: result.content?.[0]?.text || ""
  };
  eventBus?.publish?.("verification:result", { turn_id: turnId, result: verification });
  return verification;
}
