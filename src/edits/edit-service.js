import { createHash } from "node:crypto";
import {
  assertDiffPathsSafe,
  formatDiffSummary,
  parseDiff
} from "./diff-parser.js";
import { createChangeStore } from "./change-store.js";
import { createRollbackService } from "./rollback-service.js";
import {
  applyDiffTransaction,
  makeTransactionId,
  restoreSnapshots
} from "./edit-transaction.js";

export function createEditService({ projectRoot, eventBus = null, changeStore = null, rollbackService = null } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required");

  const store = changeStore || createChangeStore({ projectRoot });
  const rollback = rollbackService || createRollbackService({ projectRoot });

  async function preview({ diff } = {}) {
    const parsed = parseDiff(diff);
    await assertDiffPathsSafe(projectRoot, parsed.patches);
    const metadata = previewMetadata(parsed);
    publish("file:diff_preview", {
      summary: parsed.summary,
      files: parsed.files,
      diff_hash: metadata.diff_hash,
      diff_size: metadata.diff_size
    });
    return {
      status: "success",
      content: [{ type: "text", text: formatDiffSummary(parsed.summary) }],
      metadata
    };
  }

  async function apply({ diff, prompt = "", approval_id = null } = {}) {
    const parsed = parseDiff(diff);
    await assertDiffPathsSafe(projectRoot, parsed.patches);
    const plan = await store.capture({ diff: parsed.diff, prompt });
    let transaction;
    const transaction_id = makeTransactionId();
    publish("file:transaction_started", {
      transaction_id,
      files: parsed.files,
      summary: parsed.summary,
      diff_hash: hashText(parsed.diff),
      diff_size: Buffer.byteLength(parsed.diff, "utf8")
    });
    try {
      transaction = await applyDiffTransaction({ projectRoot, parsed, transaction_id });
    } catch (error) {
      publish("file:transaction_failed", {
        transaction_id: error.transaction_id || null,
        files: parsed.files,
        restored_files: error.restored_files || [],
        restored: Boolean(error.restored),
        message: String(error.message || error).slice(0, 500)
      });
      throw error;
    }
    let record;
    try {
      record = await store.finalize(plan, { transaction });
    } catch (error) {
      const restoredFiles = await restoreSnapshots(projectRoot, transaction.snapshots);
      publish("file:transaction_failed", {
        transaction_id,
        files: parsed.files,
        restored_files: restoredFiles,
        restored: true,
        message: String(error.message || error).slice(0, 500)
      });
      throw error;
    }
    const metadata = {
      change_id: record.id,
      approval_id,
      summary: record.summary,
      files: record.summary.map((item) => item.path),
      diff_hash: hashText(parsed.diff),
      diff_size: Buffer.byteLength(parsed.diff, "utf8"),
      change_record_path: `.deepseek-code/changes/${record.id}.json`
    };
    publish("file:diff_applied", {
      change_id: record.id,
      approval_id,
      summary: record.summary,
      files: metadata.files,
      diff_hash: metadata.diff_hash,
      diff_size: metadata.diff_size
    });
    return {
      status: "success",
      content: [{ type: "text", text: `Applied change ${record.id}\n${formatDiffSummary(record.summary)}` }],
      metadata
    };
  }

  async function rollbackChangeRecord({ change_id = "latest", force = false } = {}) {
    const outcome = await rollback.rollback({ change_id, force: Boolean(force) });
    const record = outcome.record;
    const files = record.summary.map((item) => item.path);
    if (outcome.status === "conflict") {
      publish("file:rollback_conflict", {
        change_id: record.id,
        files,
        conflicts: outcome.conflicts,
        force_available: true
      });
      return {
        status: "conflict",
        content: [{ type: "text", text: `Rollback blocked by dirty files for change ${record.id}` }],
        metadata: {
          change_id: record.id,
          conflicts: outcome.conflicts,
          force_available: true,
          files
        }
      };
    }
    publish("file:transaction_rolled_back", {
      change_id: record.id,
      files,
      restored_files: outcome.restored_files,
      forced: outcome.forced,
      conflicts: outcome.conflicts
    });
    publish("file:rollback_applied", {
      change_id: record.id,
      summary: record.summary,
      files,
      forced: outcome.forced,
      conflicts: outcome.conflicts
    });
    return {
      status: "success",
      content: [{ type: "text", text: `Rolled back change ${record.id}` }],
      metadata: {
        change_id: record.id,
        summary: record.summary,
        files,
        restored_files: outcome.restored_files,
        forced: outcome.forced,
        conflicts: outcome.conflicts
      }
    };
  }

  async function describe({ change_id = "latest" } = {}) {
    const record = await store.describe({ change_id });
    return {
      status: "success",
      content: [{ type: "text", text: `Change ${record.id}\n${formatDiffSummary(record.summary)}` }],
      metadata: {
        change_id: record.id,
        prompt: record.prompt,
        time: record.time,
        summary: record.summary,
        files: record.summary.map((item) => item.path)
      }
    };
  }

  async function list({ limit = 20 } = {}) {
    const records = await store.list({ limit });
    return {
      status: "success",
      content: [{ type: "text", text: records.map((record) => `${record.id} ${record.prompt}`).join("\n") }],
      metadata: {
        changes: records.map((record) => ({
          change_id: record.id,
          prompt: record.prompt,
          time: record.time,
          summary: record.summary
        }))
      }
    };
  }

  function publish(type, data) {
    eventBus?.publish?.(type, data);
  }

  return { preview, apply, rollback: rollbackChangeRecord, describe, list };
}

function previewMetadata(parsed) {
  return {
    summary: parsed.summary,
    files: parsed.files,
    patch_count: parsed.patches.length,
    diff_hash: hashText(parsed.diff),
    diff_size: Buffer.byteLength(parsed.diff, "utf8")
  };
}

function hashText(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}
