import { createAgentTurn, addTurnStep, setTurnStatus } from "../protocol/agent-turn.js";
import { createAgentStep, completeAgentStep } from "../protocol/agent-step.js";
import { classifyMessage } from "../planning/classifier.js";
import { createLifecycleState, transitionLifecycle } from "./lifecycle.js";

function publish(eventBus, eventType, data) {
  if (eventBus && typeof eventBus.publish === "function") {
    eventBus.publish(eventType, data);
  }
}

class InterruptedError extends Error {
  constructor(reason = "turn was interrupted") {
    super(reason);
    this.name = "InterruptedError";
    this.code = "INTERRUPTED";
  }
}

export function createAgentRuntime({ eventBus = null, sessionId = `sess_${Date.now()}`, modelGateway = null } = {}) {
  let lifecycle = createLifecycleState();
  let currentTurnId = null;
  let turnGeneration = 0;

  function getState() {
    return { ...lifecycle };
  }

  async function send(message, options = {}) {
    if (currentTurnId) {
      const err = new Error("another turn is in progress");
      err.code = "BUSY";
      throw err;
    }

    const generation = ++turnGeneration;
    let turn = createAgentTurn({
      sessionId,
      userMessage: message,
      autonomy: options.autonomy || "gated"
    });
    currentTurnId = turn.id;

    publish(eventBus, "user:message", {
      turn_id: turn.id,
      content: message,
      options
    });
    publish(eventBus, "agent:turn_started", { turn });

    try {
      lifecycle = transitionLifecycle(lifecycle, {
        to: "classify",
        reason: "user message received",
        channel: "think"
      });
      if (turnGeneration !== generation) throw new InterruptedError();

      const classifyStep = createAgentStep({
        turnId: turn.id,
        type: "classify",
        channel: "think"
      });
      const classification = classifyMessage(message, options);
      const completedClassifyStep = completeAgentStep(classifyStep, {
        outputRef: `classification:${classification.task_type}`
      });
      turn = addTurnStep(turn, completedClassifyStep);
      publish(eventBus, "agent:step", {
        turn_id: turn.id,
        step: completedClassifyStep,
        classification
      });
      if (turnGeneration !== generation) throw new InterruptedError();

      lifecycle = transitionLifecycle(lifecycle, {
        to: "complete",
        reason: "V2-0 mock runtime completed",
        channel: "system"
      });
      if (turnGeneration !== generation) throw new InterruptedError();

      const finalStep = completeAgentStep(createAgentStep({
        turnId: turn.id,
        type: "final",
        channel: "system"
      }));
      turn = addTurnStep(turn, finalStep);

      const response = modelGateway && typeof modelGateway.reply === "function"
        ? await modelGateway.reply({ message, classification, turn })
        : { content: `V2-0 mock ${classification.task_type} response` };

      // After async work, verify the turn was not interrupted
      if (turnGeneration !== generation) throw new InterruptedError();

      turn = setTurnStatus(turn, "completed");
      publish(eventBus, "agent:final", {
        turn_id: turn.id,
        content: response.content,
        status: "complete"
      });

      lifecycle = transitionLifecycle(lifecycle, {
        to: "idle",
        reason: "turn complete",
        channel: null
      });
      currentTurnId = null;

      return {
        status: "complete",
        state: "idle",
        content: response.content,
        turn
      };
    } catch (error) {
      // Only clean up if this is still the active turn.
      // A late error from an interrupted turn must NOT overwrite a new turn's state.
      if (currentTurnId !== turn.id) {
        throw error;
      }

      if (error instanceof InterruptedError) {
        currentTurnId = null;
        lifecycle = transitionLifecycle(lifecycle, {
          to: "idle",
          reason: error.message,
          channel: null
        });
        throw error;
      }

      lifecycle = transitionLifecycle(lifecycle, {
        to: "failed",
        reason: error.message,
        channel: lifecycle.channel
      });
      publish(eventBus, "agent:error", {
        turn_id: turn.id,
        message: error.message
      });
      currentTurnId = null;
      throw error;
    }
  }

  function approve(approvalId, decision) {
    publish(eventBus, "approval:resolved", {
      approval_id: approvalId,
      decision
    });
  }

  function interrupt(turnId = null) {
    turnGeneration += 1;
    currentTurnId = null;
    lifecycle = transitionLifecycle(lifecycle, {
      to: "idle",
      reason: turnId ? `turn interrupted: ${turnId}` : "interrupt requested",
      channel: null
    });
  }

  return { send, approve, interrupt, getState };
}
