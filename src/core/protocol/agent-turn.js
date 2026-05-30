import { makeId } from "../../shared/id.js";
import { nowIso } from "../../shared/time.js";

export const TURN_STATUSES = Object.freeze([
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "interrupted"
]);

export function createAgentTurn({ sessionId, userMessage, autonomy = "gated", id = makeId("turn") }) {
  if (!sessionId) throw new Error("sessionId is required");
  if (typeof userMessage !== "string" || userMessage.length === 0) {
    throw new Error("userMessage must be a non-empty string");
  }

  const now = nowIso();
  return {
    id,
    session_id: sessionId,
    user_message: userMessage,
    status: "running",
    autonomy,
    created_at: now,
    updated_at: now,
    steps: [],
    artifacts: [],
    usage: {
      total_tokens: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      reasoning_tokens: 0,
      cache_hit_tokens: 0,
      cache_miss_tokens: 0
    }
  };
}

export function setTurnStatus(turn, status) {
  if (!TURN_STATUSES.includes(status)) {
    throw new Error(`invalid turn status: ${status}`);
  }
  return { ...turn, status, updated_at: nowIso() };
}

export function addTurnStep(turn, step) {
  return {
    ...turn,
    steps: [...turn.steps, step],
    updated_at: nowIso()
  };
}
