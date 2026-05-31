import { promises as fs } from "node:fs";
import path from "node:path";
import { describeChange } from "../changes.js";
import {
  applyRollbackRecord,
  detectRollbackConflicts
} from "./edit-transaction.js";

export function createRollbackService({ projectRoot } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  return {
    async rollback({ change_id = "latest", force = false } = {}) {
      const record = await describeChange(projectRoot, change_id || "latest");
      const conflicts = await detectRollbackConflicts(projectRoot, record);
      if (conflicts.length && !force) {
        return {
          status: "conflict",
          record,
          conflicts,
          restored_files: [],
          forced: false
        };
      }
      const restoredFiles = await applyRollbackRecord(projectRoot, record);
      const rollbackPath = path.join(projectRoot, ".deepseek-code", "rollbacks.jsonl");
      await fs.mkdir(path.dirname(rollbackPath), { recursive: true });
      await fs.appendFile(rollbackPath, `${JSON.stringify({
        time: new Date().toISOString(),
        id: record.id,
        forced: Boolean(force),
        conflicts
      })}\n`, "utf8");
      return {
        status: "success",
        record,
        conflicts,
        restored_files: restoredFiles,
        forced: Boolean(force)
      };
    }
  };
}
