import { promises as fs } from "node:fs";
import path from "node:path";
import {
  captureChangePlan,
  finalizeChange,
  listChanges,
  describeChange
} from "../changes.js";
import { enhanceChangeRecord } from "./edit-transaction.js";

export function createChangeStore({ projectRoot, edits = {} } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  return {
    capture({ diff, prompt = "" } = {}) {
      return captureChangePlan(projectRoot, diff, prompt, { maxCaptureBytes: edits.maxCaptureBytes });
    },
    async finalize(plan, { transaction = null } = {}) {
      const record = await finalizeChange(projectRoot, plan, {
        maxCaptureBytes: edits.maxCaptureBytes,
        changeRetention: edits.changeRetention
      });
      if (!transaction) return record;
      const enhanced = enhanceChangeRecord(record, { transaction_id: transaction.transaction_id });
      const target = path.join(projectRoot, ".deepseek-code", "changes", `${enhanced.id}.json`);
      try {
        await fs.writeFile(target, `${JSON.stringify(enhanced, null, 2)}\n`, "utf8");
      } catch (error) {
        await fs.rm(target, { force: true });
        throw error;
      }
      return enhanced;
    },
    list({ limit = 20 } = {}) {
      return listChanges(projectRoot, limit);
    },
    describe({ change_id = "latest" } = {}) {
      return describeChange(projectRoot, change_id || "latest");
    }
  };
}
