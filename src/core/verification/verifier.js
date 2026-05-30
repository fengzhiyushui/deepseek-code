import { createToolCall } from "../protocol/index.js";
import { createVerificationPolicy } from "./verification-policy.js";

export function shouldVerifyToolResults(toolResults = []) {
  return toolResults.some((result) => result.status === "success" && result.metadata?.change_id);
}

export async function runVerifier({
  turnId,
  autonomy = "gated",
  toolResults = [],
  executeTool,
  createPolicyContext,
  verificationPolicy = createVerificationPolicy(),
  eventBus = null
} = {}) {
  const hasEditResults = shouldVerifyToolResults(toolResults);
  if (!hasEditResults) {
    const skipped = { status: "skipped", reason: "no edit results" };
    eventBus?.publish?.("verification:result", { turn_id: turnId, result: skipped });
    return skipped;
  }

  const plan = verificationPolicy.plan({
    autonomy,
    hasEditResults
  });
  if (!plan.shouldVerify) {
    const skipped = { status: "skipped", reason: plan.reason, mode: plan.mode };
    eventBus?.publish?.("verification:result", { turn_id: turnId, result: skipped });
    return skipped;
  }

  const call = createToolCall({
    name: "test",
    params: plan.testParams,
    source: "runtime",
    requestedByStepId: `verify:${turnId}`
  });
  const result = await executeTool(call, createPolicyContext({ turnId, toolCall: call, phase: "verify" }));
  const verification = mapVerificationResult(result, plan.mode);
  eventBus?.publish?.("verification:result", { turn_id: turnId, result: verification });
  return verification;
}

function mapVerificationResult(result, mode) {
  const reason = result.content?.[0]?.text || "";
  if (result.status === "success") {
    const exitCode = result.metadata?.exit_code;
    if (exitCode != null && exitCode !== 0) {
      return { status: "failed", tool_result: result, reason, exit_code: exitCode, mode };
    }
    return { status: "passed", tool_result: result, reason, mode };
  }
  if (result.status === "approval_required") {
    return { status: "approval_required", tool_result: result, reason, mode };
  }
  if (result.status === "denied") {
    return { status: "failed", tool_result: result, reason, mode };
  }
  return { status: result.status || "error", tool_result: result, reason, mode };
}
