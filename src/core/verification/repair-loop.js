import { runRepairExecutor } from "../execution/repair-executor.js";
import { runVerifier } from "./verifier.js";
import { buildRepairMessages } from "./repair-prompt.js";

export async function runRepairLoop({
  turnId,
  userMessage,
  classification = {},
  modelGateway,
  toolSchemas = [],
  executeTool,
  createPolicyContext,
  verificationPolicy,
  initialVerification,
  initialToolResults = [],
  eventBus = null,
  signal = null,
  maxRepairAttempts = 2,
  options = {},
  runVerifierImpl = runVerifier,
  runRepairExecutorImpl = runRepairExecutor
} = {}) {
  const attempts = [];
  let verification = initialVerification;
  let allToolResults = [...initialToolResults];
  eventBus?.publish?.("repair:started", { turn_id: turnId, max_attempts: maxRepairAttempts, verification_status: verification?.status });

  for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
    eventBus?.publish?.("repair:attempt", { turn_id: turnId, attempt, verification_status: verification?.status });
    const messages = buildRepairMessages({
      userMessage,
      classification,
      verification,
      toolResults: allToolResults,
      previousRepairAttempts: attempts,
      maxRepairAttempts
    });
    const repairExec = await runRepairExecutorImpl({
      turnId,
      messages,
      modelGateway,
      toolSchemas,
      executeTool,
      createPolicyContext,
      eventBus,
      signal,
      options: { ...options, message: userMessage, classification }
    });
    if (repairExec.status === "awaiting_approval") {
      return { ...repairExec, repair: { attempts: attempt, status: "awaiting_approval" }, verification };
    }

    allToolResults = [...allToolResults, ...(repairExec.toolResults || [])];
    verification = await runVerifierImpl({
      turnId,
      autonomy: options.autonomy || "gated",
      toolResults: allToolResults,
      executeTool,
      createPolicyContext,
      verificationPolicy,
      eventBus
    });
    const repairResult = {
      turn_id: turnId,
      attempt,
      status: verification.status === "passed" || verification.status === "skipped" ? "complete" : "failed",
      verification_status: verification.status,
      tool_result_count: repairExec.toolResults?.length || 0
    };
    attempts.push(repairResult);
    eventBus?.publish?.("repair:result", repairResult);

    if (verification.status === "passed" || verification.status === "skipped") {
      return {
        status: "complete",
        content: repairExec.content || "Repair complete.",
        toolResults: allToolResults,
        verification,
        repair: { attempts: attempt, status: "complete", history: attempts }
      };
    }
    if (verification.status === "approval_required") {
      return {
        status: "awaiting_approval",
        content: verification.reason || "Verification requires approval",
        approval: verification.tool_result?.metadata?.approval || null,
        toolResults: allToolResults,
        verification,
        repair: { attempts: attempt, status: "awaiting_approval", history: attempts }
      };
    }
  }

  eventBus?.publish?.("repair:exhausted", { turn_id: turnId, attempts: maxRepairAttempts, verification_status: verification?.status });
  return {
    status: "failed",
    content: verification?.reason || "Repair attempts exhausted",
    toolResults: allToolResults,
    verification,
    repair: { attempts: maxRepairAttempts, status: "exhausted", history: attempts }
  };
}
