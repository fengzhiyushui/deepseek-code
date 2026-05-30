import { makeId } from "../../shared/id.js";
import { nowIso } from "../../shared/time.js";

export const STEP_STATUSES = Object.freeze(["started", "completed", "failed", "skipped"]);

export function createAgentStep({
  turnId,
  type,
  channel = "system",
  status = "started",
  inputRef = null,
  outputRef = null,
  id = makeId("step")
}) {
  if (!turnId) throw new Error("turnId is required");
  if (!type) throw new Error("step type is required");
  if (!STEP_STATUSES.includes(status)) throw new Error(`invalid step status: ${status}`);

  return {
    id,
    turn_id: turnId,
    type,
    channel,
    status,
    input_ref: inputRef,
    output_ref: outputRef,
    started_at: nowIso(),
    ended_at: null
  };
}

export function completeAgentStep(step, { outputRef = step.output_ref, status = "completed" } = {}) {
  if (!STEP_STATUSES.includes(status)) throw new Error(`invalid step status: ${status}`);
  return {
    ...step,
    status,
    output_ref: outputRef,
    ended_at: nowIso()
  };
}
