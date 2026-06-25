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
  modelTimeoutMs = null,
  permissionContext = null,
  runVerifierImpl = runVerifier,
  runRepairExecutorImpl = runRepairExecutor,
  resumeAfterApproval = null,
  context = null
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
  let skipToVerification = resumeAfterApproval
    ? resumeAfterApproval.skip_to_verification !== false
    : false;

  for (let attempt = startAttempt; attempt <= maxRepairAttempts; attempt += 1) {
    if (!skipToVerification) {
      eventBus?.publish?.("repair:attempt", { turn_id: turnId, attempt, verification_status: verification?.status });
      const messages = buildRepairMessages({
        userMessage,
        classification,
        verification,
        toolResults: allToolResults,
        previousRepairAttempts: attempts,
        maxRepairAttempts,
        context
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
        modelTimeoutMs,
        permissionContext,
        options: { ...options, message: userMessage, classification, context }
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
              initial_tool_results: initialToolResults || [],
              max_repair_attempts: maxRepairAttempts,
              context
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
      autonomy: permissionContext?.autonomy || options.autonomy || "gated",
      toolResults: allToolResults,
      executeTool,
      createPolicyContext,
      verificationPolicy,
      eventBus
    });
    if (verification.status === "approval_required") {
      return {
        status: "awaiting_approval",
        content: verification.reason || "Verification requires approval",
        approval: verification.tool_result?.metadata?.approval || null,
        toolResults: allToolResults,
        verification,
        repair: { attempts: attempt, status: "awaiting_approval", history: attempts },
        resume_state: verifierApprovalResumeState({
          turnId,
          userMessage,
          classification,
          verification,
          allToolResults,
          attempt,
          attempts,
          initialVerification,
          initialToolResults,
          maxRepairAttempts,
          options,
          permissionContext,
          context
        })
      };
    }
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

function verifierApprovalResumeState({
  turnId,
  userMessage,
  classification,
  verification,
  allToolResults,
  attempt,
  attempts,
  initialVerification,
  initialToolResults,
  maxRepairAttempts,
  options,
  permissionContext,
  context
}) {
  const pendingToolCall = {
    id: verification.tool_result?.call_id || `verify:${turnId}`,
    name: "test",
    params: verifierParamsFromMode(verification.mode, options, permissionContext),
    source: "runtime",
    requested_by_step_id: `verify:${turnId}`
  };
  return {
    turn_id: turnId,
    message: userMessage,
    classification,
    messages: [],
    model_result: { content: "", tool_calls: [] },
    raw_tool_calls: [],
    pending_tool_call: pendingToolCall,
    remaining_tool_calls: [],
    iteration: 0,
    tool_results: [],
    tool_schemas: [],
    max_iterations: 1,
    options,
    context,
    permission_context: permissionContext,
    repair_context: {
      approval_phase: "verify",
      all_tool_results: allToolResults,
      verification,
      attempt,
      attempts: [...attempts],
      initial_verification: initialVerification,
      initial_tool_results: initialToolResults || [],
      max_repair_attempts: maxRepairAttempts,
      context
    }
  };
}

function verifierParamsFromMode(mode, options = {}, permissionContext = null) {
  if (mode === "detect") return { detect: true };
  if (mode === "run") {
    const testArgv = resolveVerifierTestArgv(options, permissionContext);
    return testArgv ? { detect: false, argv: [...testArgv] } : { detect: false };
  }
  return {};
}

function resolveVerifierTestArgv(options = {}, permissionContext = null) {
  const value = firstDefined(
    readPresent(permissionContext, "test_argv"),
    readPresent(permissionContext, "testArgv"),
    readPresent(options, "testArgv"),
    null
  );
  return Array.isArray(value) ? [...value] : null;
}

function readPresent(object, key, fallback = undefined) {
  if (object && Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  return fallback;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}
