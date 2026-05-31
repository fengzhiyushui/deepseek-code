import { makeId } from "../shared/id.js";
import { BR_MAIN } from "./branch-store.js";

const CHANGE_EVENTS = new Set(["file:diff_applied", "file:transaction_committed"]);

export function buildCheckpointIndex(events = [], { branch_id = BR_MAIN } = {}) {
  const normalized = events.map((event) => ({ ...event, branch_id: event.branch_id || BR_MAIN }));
  const branchEvents = normalized.filter((event) => (event.branch_id || BR_MAIN) === branch_id);
  const changes = [];
  const checkpoints = [];
  for (const event of branchEvents) {
    if (CHANGE_EVENTS.has(event.type) && event.change_id) {
      changes.push({
        change_id: event.change_id,
        seq: Number(event.seq || 0),
        event_id: event.event_id || null,
        turn_id: event.turn_id || null,
        files: event.files || []
      });
    }
    if (event.type === "agent:final" || event.type === "user:message") {
      checkpoints.push({
        checkpoint_id: makeId("cp"),
        branch_id,
        event_id: event.event_id || null,
        seq: Number(event.seq || 0),
        turn_id: event.turn_id || null,
        type: event.turn_id ? "turn" : "event",
        label: event.turn_id ? `after ${event.turn_id}` : event.type,
        cumulative_change_ids: changes.map((change) => change.change_id)
      });
    }
  }
  return { branch_id, events: branchEvents, changes, checkpoints };
}

export function resolveRewindTarget(index, target = {}) {
  if (!index) throw new Error("checkpoint index is required");
  if (target.event_id) {
    const event = index.events.find((item) => item.event_id === target.event_id);
    if (!event) throw new Error(`rewind target event not found: ${target.event_id}`);
    return eventToTarget(event);
  }
  if (target.turn_id) {
    const checkpoint = [...index.checkpoints].reverse().find((item) => item.turn_id === target.turn_id);
    if (!checkpoint) throw new Error(`rewind target turn not found: ${target.turn_id}`);
    return checkpoint;
  }
  if (target.seq != null) {
    const seq = Number(target.seq);
    const event = [...index.events].reverse().find((item) => Number(item.seq || 0) <= seq);
    if (!event) throw new Error(`rewind target seq not found: ${target.seq}`);
    return eventToTarget(event);
  }
  throw new Error("rewind target requires event_id, turn_id, or seq");
}

export function computeRollbackPlan(index, target) {
  const targetSeq = Number(target.seq || 0);
  const selected = index.changes.filter((change) => Number(change.seq || 0) > targetSeq).reverse();
  const files = [...new Set(selected.flatMap((change) => change.files || []))];
  return {
    branch_id: index.branch_id,
    target,
    change_ids: selected.map((change) => change.change_id),
    changes: selected,
    files,
    rollback_count: selected.length
  };
}

function eventToTarget(event) {
  return {
    branch_id: event.branch_id || BR_MAIN,
    event_id: event.event_id || null,
    seq: Number(event.seq || 0),
    turn_id: event.turn_id || null,
    type: event.type || "event",
    label: event.turn_id ? `after ${event.turn_id}` : event.type
  };
}
