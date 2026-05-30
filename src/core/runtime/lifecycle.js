import { makeId } from "../../shared/id.js";
import { nowIso } from "../../shared/time.js";

export const RUNTIME_STATES = Object.freeze([
  "idle",
  "classify",
  "plan",
  "awaiting_approval",
  "execute",
  "review",
  "verify",
  "repair",
  "complete",
  "failed",
  "interrupted"
]);

export function createLifecycleState() {
  return {
    current: "idle",
    previous: null,
    channel: null,
    reason: "runtime created",
    trace_id: makeId("trace"),
    updated_at: nowIso()
  };
}

export function transitionLifecycle(state, { to, reason, channel = state.channel }) {
  if (!RUNTIME_STATES.includes(to)) {
    throw new Error(`invalid runtime state: ${to}`);
  }
  if (!reason) {
    throw new Error("transition reason is required");
  }

  return {
    current: to,
    previous: state.current,
    channel,
    reason,
    trace_id: makeId("trace"),
    updated_at: nowIso()
  };
}
