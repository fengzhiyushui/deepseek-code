import { makeId } from "../shared/id.js";
import {
  buildCheckpointIndex,
  computeRollbackPlan,
  resolveRewindTarget
} from "./checkpoint-index.js";

export function createRewindService({
  eventBus = null,
  getTimeline,
  getActiveBranchId,
  createBranch = null,
  activateBranch = null,
  rollback
} = {}) {
  if (typeof getTimeline !== "function") throw new Error("getTimeline is required");
  if (typeof getActiveBranchId !== "function") throw new Error("getActiveBranchId is required");
  if (typeof rollback !== "function") throw new Error("rollback is required");

  async function preview({ target, branch_id = null } = {}) {
    const branchId = branch_id || await getActiveBranchId();
    const timeline = await getTimeline({ count: 10000, branch_id: branchId });
    const index = buildCheckpointIndex(timeline, { branch_id: branchId });
    const resolvedTarget = resolveRewindTarget(index, target);
    const plan = computeRollbackPlan(index, resolvedTarget);
    const plannedBranchId = makeId("br");
    const result = {
      status: "success",
      target: resolvedTarget,
      current_branch_id: branchId,
      planned_branch_id: plannedBranchId,
      rollback_change_ids: plan.change_ids,
      rollback_count: plan.rollback_count,
      files: plan.files,
      force_required: false
    };
    publish("session:rewind_preview", safeRewindPayload(result));
    return result;
  }

  async function apply({ target, branch_id = null, force = false, label = "" } = {}) {
    if (typeof createBranch !== "function") throw new Error("createBranch is required for apply");
    if (typeof activateBranch !== "function") throw new Error("activateBranch is required for apply");
    const previewResult = await preview({ target, branch_id });
    const currentBranchId = previewResult.current_branch_id;
    publish("session:rewind_started", {
      current_branch_id: currentBranchId,
      target: previewResult.target,
      rollback_change_ids: previewResult.rollback_change_ids,
      forced: Boolean(force)
    });

    const appliedRollbacks = [];
    for (const changeId of previewResult.rollback_change_ids) {
      const result = await rollback({ change_id: changeId, force: Boolean(force), branch_id: previewResult.planned_branch_id });
      if (result.status === "conflict") {
        const conflict = {
          status: "conflict",
          current_branch_id: currentBranchId,
          attempted_branch_id: previewResult.planned_branch_id,
          failed_change_id: changeId,
          applied_rollbacks: appliedRollbacks,
          remaining_change_ids: previewResult.rollback_change_ids.slice(appliedRollbacks.length),
          conflicts: result.metadata?.conflicts || [],
          forced: Boolean(force)
        };
        publish("session:rewind_conflict", conflict);
        return conflict;
      }
      if (result.status !== "success") {
        const failed = {
          status: "failed",
          current_branch_id: currentBranchId,
          failed_change_id: changeId,
          applied_rollbacks: appliedRollbacks,
          reason: result.content?.[0]?.text || result.status || "rollback failed"
        };
        publish("session:rewind_failed", failed);
        return failed;
      }
      appliedRollbacks.push(changeId);
    }

    const branch = await createBranch({
      parent_branch_id: currentBranchId,
      forked_from_event_id: previewResult.target.event_id,
      forked_from_seq: previewResult.target.seq,
      forked_from_turn_id: previewResult.target.turn_id,
      label: label || `rewind to ${previewResult.target.turn_id || previewResult.target.event_id || previewResult.target.seq}`
    });
    publish("session:branch_created", {
      branch_id: branch.branch_id,
      parent_branch_id: branch.parent_branch_id,
      forked_from_event_id: branch.forked_from_event_id,
      forked_from_seq: branch.forked_from_seq,
      forked_from_turn_id: branch.forked_from_turn_id
    });
    await activateBranch(branch.branch_id);
    publish("session:branch_activated", {
      branch_id: branch.branch_id,
      parent_branch_id: branch.parent_branch_id
    });
    const success = {
      status: "success",
      previous_branch_id: currentBranchId,
      branch_id: branch.branch_id,
      target: previewResult.target,
      rollback_change_ids: previewResult.rollback_change_ids,
      applied_rollbacks: appliedRollbacks,
      files: previewResult.files,
      forced: Boolean(force)
    };
    publish("session:rewind_applied", success);
    return success;
  }

  function publish(type, data) {
    eventBus?.publish?.(type, data);
  }

  return { preview, apply };
}

function safeRewindPayload(result) {
  return {
    target: result.target,
    current_branch_id: result.current_branch_id,
    planned_branch_id: result.planned_branch_id,
    rollback_change_ids: result.rollback_change_ids,
    rollback_count: result.rollback_count,
    files: result.files,
    force_required: result.force_required
  };
}
