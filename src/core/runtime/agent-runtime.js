import { createAgentTurn, addTurnStep, setTurnStatus } from "../protocol/agent-turn.js";
import { createAgentStep, completeAgentStep } from "../protocol/agent-step.js";
import { classifyMessage } from "../planning/classifier.js";
import { runExecutorLoop, resumeExecutorLoop } from "../execution/executor-loop.js";
import { runVerifier } from "../verification/verifier.js";
import { decideRepair } from "../verification/repair-decision.js";
import { createPausedTurnStore } from "../approval/paused-turn-store.js";
import { createLifecycleState, transitionLifecycle } from "./lifecycle.js";

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
  pausedTurnStore = createPausedTurnStore(),
  grantApprovalForToolCall = async () => {}
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

      let response;
      if (classification.task_type === "query" || !modelGateway?.invoke || !executeTool) {
        response = await runReplyFastPath({ message, classification, turn, options, signal: currentAbortController.signal });
      } else {
        response = await runToolLoopPath({ message, classification, turn, options, signal: currentAbortController.signal });
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

      turn = setTurnStatus(turn, "completed");
      publish(eventBus, "agent:final", { turn_id: turn.id, content: response.content, status: "complete" });
      lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "turn complete", channel: null });
      currentTurnId = null;
      currentAbortController = null;
      return { status: "complete", state: "idle", content: response.content, turn, verification: response.verification || null };
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

  async function runReplyFastPath({ message, classification, turn, options, signal }) {
    lifecycle = transitionLifecycle(lifecycle, { to: "complete", reason: "reply fast path", channel: "system" });
    const finalStep = completeAgentStep(createAgentStep({ turnId: turn.id, type: "final", channel: "system" }));
    const updatedTurn = addTurnStep(turn, finalStep);
    const response = modelGateway && typeof modelGateway.reply === "function"
      ? await modelGateway.reply({ message, classification, turn, options, signal })
      : { content: `V2-0 mock ${classification.task_type} response` };
    return { status: "complete", content: response.content, turn: updatedTurn };
  }

  async function runToolLoopPath({ message, classification, turn, options, signal }) {
    lifecycle = transitionLifecycle(lifecycle, { to: "execute", reason: "tool loop started", channel: "act" });
    const loop = await runExecutorLoop({
      message,
      classification,
      turnId: turn.id,
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
      options
    });
    if (loop.status === "awaiting_approval") return loop;

    lifecycle = transitionLifecycle(lifecycle, { to: "verify", reason: "tool loop complete", channel: "system" });
    const verification = await runVerifier({
      turnId: turn.id,
      toolResults: loop.toolResults,
      executeTool,
      createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
        autonomy: "auto",
        turnId,
        toolCall,
        phase
      }),
      eventBus
    });
    const repair = decideRepair(verification);
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
      lifecycle = transitionLifecycle(lifecycle, { to: "failed", reason: repair.reason, channel: "system" });
      throw new Error(`verification failed: ${verification.reason}`);
    }
    return { ...loop, verification };
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
      const loop = await resumeExecutorLoop({
        resumeState: record.resume_state,
        modelGateway,
        executeTool,
        createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
          ...(record.resume_state.options || {}),
          autonomy: record.turn.autonomy,
          turnId,
          toolCall,
          phase
        }),
        eventBus,
        signal: currentAbortController.signal
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
      lifecycle = transitionLifecycle(lifecycle, { to: "verify", reason: "tool loop complete", channel: "system" });
      const verification = await runVerifier({
        turnId: record.turn_id,
        toolResults: loop.toolResults,
        executeTool,
        createPolicyContext: ({ turnId, toolCall, phase }) => createPolicyContext({
          autonomy: "auto",
          turnId,
          toolCall,
          phase
        }),
        eventBus
      });
      const repair = decideRepair(verification);
      if (repair.decision === "stop" && verification.status === "approval_required") {
        lifecycle = transitionLifecycle(lifecycle, { to: "awaiting_approval", reason: "verification approval required", channel: "system" });
        currentTurnId = null;
        currentAbortController = null;
        return {
          status: "awaiting_approval",
          state: "awaiting_approval",
          content: verification.reason || "Verification requires approval",
          approval: verification.tool_result?.metadata?.approval || null,
          turn: setTurnStatus(record.turn, "awaiting_approval"),
          verification
        };
      }
      if (repair.decision === "repair") {
        throw new Error(`verification failed: ${verification.reason}`);
      }
      const finalTurn = setTurnStatus(record.turn, "completed");
      publish(eventBus, "agent:final", { turn_id: record.turn_id, content: loop.content, status: "complete" });
      lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: "turn complete", channel: null });
      currentTurnId = null;
      currentAbortController = null;
      return { status: "complete", state: "idle", content: loop.content, turn: finalTurn, verification };
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
