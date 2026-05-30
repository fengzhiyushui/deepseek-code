import { rollbackChange } from "../changes.js";

export function createRollbackService({ projectRoot } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  return {
    rollback({ change_id = "latest" } = {}) {
      return rollbackChange(projectRoot, change_id || "latest");
    }
  };
}
