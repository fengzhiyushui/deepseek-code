import { nowIso } from "../../shared/time.js";

export function createPausedTurnStore({ now = nowIso } = {}) {
  const records = new Map();

  function save(record) {
    validateRecord(record);
    if (records.has(record.approval_id)) {
      throw new Error(`paused approval already exists: ${record.approval_id}`);
    }
    const stored = {
      ...record,
      created_at: record.created_at || now()
    };
    records.set(stored.approval_id, stored);
    return stored;
  }

  function get(approvalId) {
    return records.get(approvalId) || null;
  }

  function take(approvalId) {
    const record = get(approvalId);
    if (!record) return null;
    records.delete(approvalId);
    return record;
  }

  function deleteForTurn(turnId) {
    let removed = 0;
    for (const [approvalId, record] of records.entries()) {
      if (record.turn_id === turnId) {
        records.delete(approvalId);
        removed += 1;
      }
    }
    return removed;
  }

  function clear() {
    records.clear();
  }

  function size() {
    return records.size;
  }

  return { save, get, take, deleteForTurn, clear, size };
}

function validateRecord(record) {
  if (!record || typeof record !== "object") throw new Error("paused record is required");
  if (!record.approval_id) throw new Error("approval_id is required");
  if (!record.turn_id) throw new Error("turn_id is required");
  if (!record.approval || typeof record.approval !== "object") throw new Error("approval is required");
  if (record.approval.id !== record.approval_id) throw new Error("approval.id must match approval_id");
  if (!record.turn || typeof record.turn !== "object") throw new Error("turn is required");
  if (!record.resume_state || typeof record.resume_state !== "object") throw new Error("resume_state is required");
}
