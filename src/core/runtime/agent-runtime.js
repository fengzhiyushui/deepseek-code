import { createAgentTurn, addTurnStep, setTurnStatus } from "../protocol/agent-turn.js";
import { createAgentStep, completeAgentStep } from "../protocol/agent-step.js";
import { classifyMessage } from "../planning/classifier.js";
import { runExecutorLoop, resumeExecutorLoop } from "../execution/executor-loop.js";
import { runVerifier } from "../verification/verifier.js";
import { decideRepair } from "../verification/repair-decision.js";
import { createVerificationPolicy } from "../verification/verification-policy.js";
import { runRepairLoop } from "../verification/repair-loop.js";
import { createPausedTurnStore } from "../approval/paused-turn-store.js";
import { createLifecycleState, transitionLifecycle } from "./lifecycle.js";
import { createCostBudget } from "./cost-budget.js";

function publish(eventBus, eventType, data) {
  if (eventBus && typeof eventBus.publish === "function") eventBus.publish(eventType, data);
}

class InterruptedError extends Error {
  constructor(reason = "turn was interrupted") {
    super(reason);
    this.name = "InterruptedError";
    this.code = "INTERRUPTED";
  }
}

export function createAgentRuntime({
  eventBus = null,
  sessionId = `sess_${Date.now()}`,
  modelGateway = null,
  toolSchemas = () => [],
  executeTool = null,
  createPolicyContext = () => ({}),
  maxToolIterations = 5,
  maxRepairAttempts = 2,
  verifyMode = "auto",
  testArgv = null,
  pausedTurnStore = createPausedTurnStore(),
  grantApprovalForToolCall = async () => {},
  createContextSnapshot = async () => null,
  maxTurnTokens = null,
  maxModelCalls = null,
  modelTimeoutMs = null,
  maxToolCallRepairs = 0
} = {}) {
  let lifecycle = createLifecycleState();
  let currentTurnId = null;
  let currentAbortController = null;
  let turnGeneration = 0;

  function getState() { return { ...lifecycle }; }
  function assertNotInterrupted(generation) { if (turnGeneration !== generation) throw new InterruptedError(); }

  async function send(message, options = {}) {
    if (pausedTurnStore.size() > 0) {
      const err = new Error("approval is awaiting resolution");
      err.code = "AWAITING_APPROVAL";
      throw err;
    }
    if (currentTurnId) { const err = new Error("another turn is in progress"); err.code = "BUSY"; throw err; }
    const generation = ++turnGeneration;
    currentAbortController = new AbortController();
    let turn = createAgentTurn({ sessionId, userMessage: message, autonomy: options.autonomy || "gated" });
    currentTurnId = turn.id;
    publish(eventBus, "user:message", { turn_id: turn.id, content: message, options });
    publish(eventBus, "agent:turn_started", { turn });
    try {
      lifecycle = transitionLifecycle(lifecycle, { to: "classify", reason: "user message received", channel: "think" });
      assertNotInterrupted(generation);
      const classifyStep = createAgentStep({ turnId: turn.id, type: "classify", channel: "think" });
      const classification = classifyMessage(message, options);
      const completedClassifyStep = completeAgentStep(classifyStep, { outputRef: `classification:${classification.task_type}` });
      turn = addTurnStep(turn, completedClassifyStep);
      publish(eventBus, "agent:step", { turn_id: turn.id, step: completedClassifyStep, classification });
      assertNotInterrupted(generation);

      const context = await createContextSnapshot({
        message,
        classification,
        channel: classification.task_type === "query" ? "reply" : "act",
        phase: "execute",
        options
      });

      let response;
      if (classification.task_type === "query" || !modelGateway?.invoke || !executeTool) {
        response = await runReplyFastPath({ message, classification, turn, options, signal: currentAbortController.signal, context });
      } else {
        response = await runToolLoopPath({ message, classification, turn, options, signal: currentAbortController.signal, context });
      }
      assertNotInterrupted(generation);

      if (response.turn) {
        turn = response.turn;
      }

      if (response.status === "awaiting_approval") {
        if (response.approval?.id && response.resume_state) {
          pausedTurnStore.save({
            approval_id: response.approval.id,
            turn_id: turn.id,
            approval: response.approval,
            turn,
            resume_state: response.resume_state
          });
        }
        lifecycle = transitionLifecycle(lifecycle, { to: "awaiting_approval", reason: "tool approval required", channel: "system" });
        turn = setTurnStatus(turn, "awaiting_approval");
        currentTurnId = null;
        currentAbortController = null;
        return { status: "awaiting_approval", state: "awaiting_approval", content: response.content, approval: response.approval, turn };
      }

      if (response.status === "stopped") {
        turn = setTurnStatus(turn, "completed");
        publish(eventBus, "agent:final", { turn_id: turn.id, content: response.content, status: "stopped" });
        lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "cost budget stop", channel: null });
        currentTurnId = null;
        currentAbortController = null;
        return { status: "stopped", state: "idle", content: response.content, turn, budget: response.reason || null };
      }

      if (response.status === "failed") {
        throw new Error(`verification failed: ${response.content || response.verification?.reason || "repair failed"}`);
      }

      turn = setTurnStatus(turn, "completed");
      publish(eventBus, "agent:final", { turn_id: turn.id, content: response.content, status: "complete" });
      lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "turn complete", channel: null });
      currentTurnId = null;
      currentAbortController = null;
      return { status: "complete", state: "idle", content: response.content, turn, verification: response.verification || null, repair: response.repair || null };
    } catch (error) {
      if (currentTurnId !== turn.id) throw error;
      if (error instanceof InterruptedError || error.name === "AbortError") {
        currentTurnId = null;
        currentAbortController = null;
        lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: error.message, channel: null });
        throw error instanceof InterruptedError ? error : new InterruptedError(error.message);
      }
      lifecycle = transitionLifecycle(lifecycle, { to: "failed", reason: error.message, channel: lifecycle.channel });
      publish(eventBus, "agent:error", { turn_id: turn.id, message: error.message });
      currentTurnId = null;
      currentAbortController = null;
      throw error;
    }
  }

  async function runReplyFastPath({ message, classification, turn, options, signal, context = null }) {
    lifecycle = transitionLifecycle(lifecycle, { to: "complete", reason: "reply fast path", channel: "system" });
    const finalStep = completeAgentStep(createAgentStep({ turnId: turn.id, type: "final", channel: "system" }));
    const updatedTurn = addTurnStep(turn, finalStep);
    const response = modelGateway && typeof modelGateway.reply === "function"
      ? await modelGateway.reply({ message, classification, turn, options: { ...options, timeoutMs: options.timeoutMs ?? modelTimeoutMs }, signal, context })
      : { content: `V2-0 mock ${classification.task_type} response` };
    return { status: "complete", content: response.content, turn: updatedTurn, context };
  }

  async function runToolLoopPath({ message, classification, turn, options, signal, context = null }) {
    lifecycle = transitionLifecycle(lifecycle, { to: "execute", reason: "tool loop started", channel: "act" });
    const budget = createCostBudget({
      maxTokens: options.maxTurnTokens ?? maxTurnTokens,
      maxModelCalls: options.maxModelCalls ?? maxModelCalls
    });
    const loop = await runExecutorLoop({
      message,
      classification,
      turnId: turn.id,
      context,
      modelGateway,
      toolSchemas: typeof toolSchemas === "function" ? toolSchemas() : toolSchemas,
      executeTool,
      createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
        ...options,
        autonomy: options.autonomy || turn.autonomy,
        turnId,
        toolCall,
        phase
      }),
      eventBus,
      signal,
      maxIterations: options.maxToolIterations || maxToolIterations,
      budget,
      modelTimeoutMs: options.modelTimeoutMs ?? modelTimeoutMs,
      maxToolCallRepairs: options.maxToolCallRepairs ?? maxToolCallRepairs,
      options
    });
    if (loop.status === "awaiting_approval") return loop;
    if (loop.status === "stopped") return loop;

    return verifyAndMaybeRepair({ turn, message, classification, loop, options, signal, context });
  }

  async function verifyAndMaybeRepair({ turn, message, classification, loop, options, signal, context = null }) {
    lifecycle = transitionLifecycle(lifecycle, { to: "verify", reason: "tool loop complete", channel: "system" });
    const verificationPolicy = createVerificationPolicy({
      verifyMode: options.verifyMode || verifyMode,
      testArgv: options.testArgv || testArgv
    });
    const verification = await runVerifier({
      turnId: turn.id,
      autonomy: options.autonomy || turn.autonomy,
      toolResults: loop.toolResults,
      executeTool,
      createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
        autonomy: "auto",
        turnId,
        toolCall,
        phase
      }),
      verificationPolicy,
      eventBus
    });
    const repair = decideRepair(verification);
    if (repair.decision === "none") return { ...loop, verification, repair: null };
    if (repair.decision === "stop" && verification.status === "approval_required") {
      return {
        status: "awaiting_approval",
        content: verification.reason || "Verification requires approval",
        approval: verification.tool_result?.metadata?.approval || null,
        toolResults: loop.toolResults,
        iterations: loop.iterations,
        verification
      };
    }
    if (repair.decision === "repair") {
      lifecycle = transitionLifecycle(lifecycle, { to: "repair", reason: repair.reason, channel: "think" });
      const repairLoop = await runRepairLoop({
        turnId: turn.id,
        userMessage: message,
        classification,
        modelGateway,
        toolSchemas: typeof toolSchemas === "function" ? toolSchemas() : toolSchemas,
        executeTool,
        createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
          ...options,
          autonomy: phase === "verify" ? "auto" : (options.autonomy || turn.autonomy),
          turnId,
          toolCall,
          phase
        }),
        verificationPolicy,
        initialVerification: verification,
        initialToolResults: loop.toolResults,
        eventBus,
        signal,
        maxRepairAttempts: options.maxRepairAttempts || maxRepairAttempts,
        modelTimeoutMs: options.modelTimeoutMs ?? modelTimeoutMs,
        options,
        context
      });
      return repairLoop;
    }
    return { status: "failed", content: repair.reason, verification, toolResults: loop.toolResults };
  }

  async function approve(approvalId, decision = "approve") {
    const normalized = normalizeApprovalDecision(decision);
    const record = pausedTurnStore.take(approvalId);
    if (!record) {
      const err = new Error(`approval not found: ${approvalId}`);
      err.code = "APPROVAL_NOT_FOUND";
      throw err;
    }
    publish(eventBus, "approval:resolved", { approval_id: approvalId, decision: normalized });

    if (normalized === "deny") {
      lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "approval denied", channel: null });
      publish(eventBus, "agent:final", { turn_id: record.turn_id, content: "Approval denied.", status: "cancelled" });
      return { status: "cancelled", state: "idle", content: "Approval denied.", approval: record.approval, turn: setTurnStatus(record.turn, "completed") };
    }

    if (currentTurnId) {
      const err = new Error("another turn is in progress");
      err.code = "BUSY";
      throw err;
    }

    currentTurnId = record.turn_id;
    currentAbortController = new AbortController();
    lifecycle = transitionLifecycle(lifecycle, { to: "execute", reason: "approval resolved", channel: "act" });
    try {
      await grantApprovalForToolCall(record.resume_state.pending_tool_call, {
        turnId: record.turn_id,
        toolCall: record.resume_state.pending_tool_call,
        options: record.resume_state.options || {}
      });
      const resumeOptions = record.resume_state.options || {};
      const budget = createCostBudget({
        maxTokens: resumeOptions.maxTurnTokens ?? maxTurnTokens,
        maxModelCalls: resumeOptions.maxModelCalls ?? maxModelCalls
      });
      const loop = await resumeExecutorLoop({
        resumeState: record.resume_state,
        modelGateway,
        executeTool,
        createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
          ...resumeOptions,
          autonomy: record.turn.autonomy,
          turnId,
          toolCall,
          phase
        }),
        eventBus,
        signal: currentAbortController.signal,
        budget,
        modelTimeoutMs: resumeOptions.modelTimeoutMs ?? modelTimeoutMs,
        maxToolCallRepairs: resumeOptions.maxToolCallRepairs ?? maxToolCallRepairs
      });
      if (loop.status === "awaiting_approval") {
        pausedTurnStore.save({
          approval_id: loop.approval.id,
          turn_id: record.turn_id,
          approval: loop.approval,
          turn: record.turn,
          resume_state: loop.resume_state
        });
        lifecycle = transitionLifecycle(lifecycle, { to: "awaiting_approval", reason: "tool approval required", channel: "system" });
        currentTurnId = null;
        currentAbortController = null;
        return { status: "awaiting_approval", state: "awaiting_approval", content: loop.content, approval: loop.approval, turn: setTurnStatus(record.turn, "awaiting_approval") };
      }

      if (loop.status === "stopped") {
        const stoppedTurn = setTurnStatus(record.turn, "completed");
        publish(eventBus, "agent:final", { turn_id: record.turn_id, content: loop.content, status: "stopped" });
        lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "cost budget stop", channel: null });
        currentTurnId = null;
        currentAbortController = null;
        return { status: "stopped", state: "idle", content: loop.content, turn: stoppedTurn, budget: loop.reason || null };
      }

      // Repair-phase approval: resume within the repair loop, not a fresh verifyAndMaybeRepair
      if (record.resume_state.repair_context) {
        const ctx = record.resume_state.repair_context;
        const mergedToolResults = [...ctx.all_tool_results, ...(loop.toolResults || [])];
        const repairResult = await runRepairLoop({
          turnId: record.turn_id,
          userMessage: record.turn.user_message,
          classification: record.resume_state.classification || { task_type: "edit" },
          modelGateway,
          toolSchemas: typeof toolSchemas === "function" ? toolSchemas() : toolSchemas,
          executeTool,
          createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
            ...(record.resume_state.options || {}),
            autonomy: phase === "verify" ? "auto" : (record.turn.autonomy),
            turnId,
            toolCall,
            phase
          }),
          verificationPolicy: createVerificationPolicy({
            verifyMode: record.resume_state.options?.verifyMode || verifyMode,
            testArgv: record.resume_state.options?.testArgv || testArgv
          }),
          initialVerification: ctx.initial_verification,
          initialToolResults: ctx.initial_tool_results || [],
          eventBus,
          signal: currentAbortController.signal,
          maxRepairAttempts: ctx.max_repair_attempts,
          modelTimeoutMs: record.resume_state.options?.modelTimeoutMs ?? modelTimeoutMs,
          options: record.resume_state.options || {},
          context: record.resume_state.context || record.resume_state.repair_context?.context || null,
          resumeAfterApproval: {
            all_tool_results: mergedToolResults,
            verification: ctx.verification,
            attempt: ctx.attempt,
            attempts: ctx.attempts
          }
        });

        if (repairResult.status === "awaiting_approval") {
          if (repairResult.approval?.id && repairResult.resume_state) {
            pausedTurnStore.save({
              approval_id: repairResult.approval.id,
              turn_id: record.turn_id,
              approval: repairResult.approval,
              turn: record.turn,
              resume_state: repairResult.resume_state
            });
          }
          lifecycle = transitionLifecycle(lifecycle, { to: "awaiting_approval", reason: "repair approval required", channel: "system" });
          currentTurnId = null;
          currentAbortController = null;
          return {
            status: "awaiting_approval",
            state: "awaiting_approval",
            content: repairResult.content,
            approval: repairResult.approval,
            turn: setTurnStatus(record.turn, "awaiting_approval"),
            verification: repairResult.verification
          };
        }

        if (repairResult.status === "failed") {
          throw new Error(`verification failed: ${repairResult.content || repairResult.verification?.reason || "repair failed"}`);
        }

        const finalTurn = setTurnStatus(record.turn, "completed");
        publish(eventBus, "agent:final", { turn_id: record.turn_id, content: repairResult.content, status: "complete" });
        lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "turn complete", channel: null });
        currentTurnId = null;
        currentAbortController = null;
        return { status: "complete", state: "idle", content: repairResult.content, turn: finalTurn, verification: repairResult.verification, repair: repairResult.repair || null };
      }

      const repaired = await verifyAndMaybeRepair({
        turn: record.turn,
        message: record.turn.user_message,
        classification: record.resume_state.classification || { task_type: "edit" },
        loop,
        options: record.resume_state.options || {},
        signal: currentAbortController.signal,
        context: record.resume_state.context || null
      });
      if (repaired.status === "awaiting_approval") {
        lifecycle = transitionLifecycle(lifecycle, { to: "awaiting_approval", reason: "repair approval required", channel: "system" });
        currentTurnId = null;
        currentAbortController = null;
        return {
          status: "awaiting_approval",
          state: "awaiting_approval",
          content: repaired.content,
          approval: repaired.approval,
          turn: setTurnStatus(record.turn, "awaiting_approval"),
          verification: repaired.verification
        };
      }
      if (repaired.status === "failed") {
        throw new Error(`verification failed: ${repaired.content || repaired.verification?.reason || "repair failed"}`);
      }
      const finalTurn = setTurnStatus(record.turn, "completed");
      publish(eventBus, "agent:final", { turn_id: record.turn_id, content: repaired.content, status: "complete" });
      lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "turn complete", channel: null });
      currentTurnId = null;
      currentAbortController = null;
      return { status: "complete", state: "idle", content: repaired.content, turn: finalTurn, verification: repaired.verification, repair: repaired.repair || null };
    } catch (error) {
      lifecycle = transitionLifecycle(lifecycle, { to: "failed", reason: error.message, channel: lifecycle.channel });
      publish(eventBus, "agent:error", { turn_id: record.turn_id, message: error.message });
      currentTurnId = null;
      currentAbortController = null;
      throw error;
    }
  }

  function interrupt(turnId = null) {
    turnGeneration += 1;
    if (currentAbortController) currentAbortController.abort();
    pausedTurnStore.clear();
    currentTurnId = null;
    currentAbortController = null;
    lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: turnId ? `turn interrupted: ${turnId}` : "interrupt requested", channel: null });
  }

  return { send, approve, interrupt, getState };
}

function normalizeApprovalDecision(decision) {
  const value = String(decision || "").toLowerCase();
  if (value === "approve" || value === "allow" || value === "yes") return "approve";
  if (value === "deny" || value === "reject" || value === "no") return "deny";
  throw new Error(`unknown approval decision: ${decision}`);
}
