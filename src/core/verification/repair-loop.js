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
  runRepairExecutorImpl = runRepairExecutor,
  resumeAfterApproval = null
} = {}) {
  const attempts = resumeAfterApproval ? [...resumeAfterApproval.attempts] : [];
  let verification = resumeAfterApproval ? resumeAfterApproval.verification : initialVerification;
  let allToolResults = resumeAfterApproval
    ? [...resumeAfterApproval.all_tool_results]
    : [...initialToolResults];

  if (!resumeAfterApproval) {
    eventBus?.publish?.("repair:started", { turn_id: turnId, max_attempts: maxRepairAttempts, verification_status: verification?.status });
  }

  const startAttempt = resumeAfterApproval ? resumeAfterApproval.attempt : 1;
  let skipToVerification = !!resumeAfterApproval;

  for (let attempt = startAttempt; attempt <= maxRepairAttempts; attempt += 1) {
    if (!skipToVerification) {
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
        return {
          ...repairExec,
          repair: { attempts: attempt, status: "awaiting_approval" },
          verification,
          resume_state: {
            ...repairExec.resume_state,
            repair_context: {
              all_tool_results: allToolResults,
              verification,
              attempt,
              attempts: [...attempts],
              initial_verification: initialVerification,
              max_repair_attempts: maxRepairAttempts
            }
          }
        };
      }

      allToolResults = [...allToolResults, ...(repairExec.toolResults || [])];
    } else {
      // Resuming after an approval within this attempt:
      // allToolResults already includes the resumed repair executor results
      // (merged by caller), skip build+exec, go straight to verification
      skipToVerification = false;
    }

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
      tool_result_count: allToolResults.length
    };
    attempts.push(repairResult);
    eventBus?.publish?.("repair:result", repairResult);

    if (verification.status === "passed" || verification.status === "skipped") {
      return {
        status: "complete",
        content: "Repair complete.",
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
