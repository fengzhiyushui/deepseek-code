import {
  captureChangePlan,
  finalizeChange,
  listChanges,
  describeChange
} from "../changes.js";

export function createChangeStore({ projectRoot } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  return {
    capture({ diff, prompt = "" } = {}) {
      return captureChangePlan(projectRoot, diff, prompt);
    },
    finalize(plan) {
      return finalizeChange(projectRoot, plan);
    },
    list({ limit = 20 } = {}) {
      return listChanges(projectRoot, limit);
    },
    describe({ change_id = "latest" } = {}) {
      return describeChange(projectRoot, change_id || "latest");
    }
  };
}
