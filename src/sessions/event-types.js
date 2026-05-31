export const SESSION_EVENT_TYPES = Object.freeze([
  "session:start",
  "session:resume",
  "user:message",
  "agent:turn_started",
  "agent:step",
  "model:request",
  "model:response",
  "tool:call",
  "tool:result",
  "permission:decision",
  "approval:requested",
  "approval:resolved",
  "context:snapshot",
  "context:pin",
  "context:unpin",
  "context:warm",
  "context:cache_loaded",
  "context:cache_saved",
  "context:cache_reused",
  "file:diff_preview",
  "file:diff_applied",
  "file:rollback_applied",
  "file:transaction_started",
  "file:transaction_committed",
  "file:transaction_failed",
  "file:transaction_rolled_back",
  "file:rollback_conflict",
  "verification:result",
  "repair:started",
  "repair:attempt",
  "repair:result",
  "repair:exhausted",
  "agent:final",
  "agent:error"
]);

export function isSessionEventType(type) {
  return SESSION_EVENT_TYPES.includes(type);
}

export function assertSessionEventType(type) {
  if (!isSessionEventType(type)) {
    throw new Error(`unknown session event type: ${type}`);
  }
}
