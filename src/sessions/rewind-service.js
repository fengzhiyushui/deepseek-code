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

  async function apply() {
    throw new Error("rewind apply unavailable before V2-12C");
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
