import { createAgentTurn, addTurnStep, setTurnStatus } from "../protocol/agent-turn.js";
import { createAgentStep, completeAgentStep } from "../protocol/agent-step.js";
import { classifyMessage } from "../planning/classifier.js";
import { runExecutorLoop } from "../execution/executor-loop.js";
import { runVerifier } from "../verification/verifier.js";
import { decideRepair } from "../verification/repair-decision.js";
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
  maxToolIterations = 5
} = {}) {
  let lifecycle = createLifecycleState();
  let currentTurnId = null;
  let currentAbortController = null;
  let turnGeneration = 0;

  function getState() { return { ...lifecycle }; }
  function assertNotInterrupted(generation) { if (turnGeneration !== generation) throw new InterruptedError(); }

  async function send(message, options = {}) {
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

  function approve(approvalId, decision) { publish(eventBus, "approval:resolved", { approval_id: approvalId, decision }); }

  function interrupt(turnId = null) {
    turnGeneration += 1;
    if (currentAbortController) currentAbortController.abort();
    currentTurnId = null;
    currentAbortController = null;
    lifecycle = transitionLifecycle(lifecycle, { to: "idle", reason: turnId ? `turn interrupted: ${turnId}` : "interrupt requested", channel: null });
  }

  return { send, approve, interrupt, getState };
}
