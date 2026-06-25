import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicReadJson, atomicWriteJson, safeRecoverySegment } from "./atomic-file.js";
import { createRecoveryFaults } from "./recovery-faults.js";

const SCHEMA_VERSION = 1;
const VALID_SURFACES = new Set(["cli", "tui", "gui"]);

export function createPausedTurnPersistence({ root, projectId, faults = createRecoveryFaults() }) {
  if (!root) throw new Error("root is required");
  const projectSegment = safeRecoverySegment(projectId);
  const baseDir = path.join(root, ".deepseek-code", "v2", "sessions", projectSegment, "paused");
  const quarantineDir = path.join(baseDir, "quarantine");

  function sidecarPath(approvalId) {
    return path.join(baseDir, `${safeRecoverySegment(approvalId)}.json`);
  }

  async function save(record) {
    const normalized = validateRecord(record);
    await atomicWriteJson(sidecarPath(normalized.approval_id), normalized);
    await faults.maybe("after-paused-sidecar-write");
    return normalized;
  }

  async function load(approvalId) {
    const filePath = sidecarPath(approvalId);
    const record = await atomicReadJson(filePath);
    return validateRecord(record, { expectedApprovalId: safeRecoverySegment(approvalId) });
  }

  async function deleteSidecar(approvalId) {
    try {
      await faults.maybe("before-paused-sidecar-delete");
      await unlink(sidecarPath(approvalId));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function consume(approvalId) {
    const id = safeRecoverySegment(approvalId);
    const filePath = sidecarPath(id);
    const consumed = {
      schema_version: SCHEMA_VERSION,
      approval_id: id,
      status: "consumed",
      consumed_at: new Date().toISOString(),
      reason: "consumed"
    };
    try {
      await atomicWriteJson(filePath, consumed);
    } catch (writeError) {
      try {
        const deleted = await deleteSidecar(id);
        return {
          status: deleted ? "deleted" : "missing",
          approval_id: id,
          path: filePath,
          reason: sanitizeReason(writeError?.message || "consumed paused sidecar tombstone write failed")
        };
      } catch {
        throw writeError;
      }
    }
    try {
      const deleted = await deleteSidecar(id);
      return { status: deleted ? "deleted" : "missing", approval_id: id, path: filePath };
    } catch (error) {
      const reason = sanitizeReason(error?.message || "consumed paused sidecar cleanup failed");
      await atomicWriteJson(filePath, { ...consumed, reason }).catch(() => {});
      return { status: "consumed", approval_id: id, path: filePath, reason };
    }
  }

  async function quarantine(approvalId, reason = "quarantined") {
    const id = safeRecoverySegment(approvalId);
    const source = sidecarPath(id);
    const target = path.join(quarantineDir, `${id}.json`);
    try {
      await mkdir(quarantineDir, { recursive: true });
      await rename(source, target);
      return { status: "quarantined", approval_id: id, path: target, reason: sanitizeReason(reason) };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { status: "missing", approval_id: id, path: source, reason: "sidecar not found" };
      }
      throw error;
    }
  }

  async function scan() {
    let entries;
    try {
      entries = await readdir(baseDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }

    const scanned = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const approvalId = entry.name.slice(0, -".json".length);
      const filePath = path.join(baseDir, entry.name);
      try {
        safeRecoverySegment(approvalId);
        const record = await atomicReadJson(filePath);
        scanned.push(record?.status === "consumed"
          ? validateConsumedRecord(record, { expectedApprovalId: approvalId, path: filePath })
          : validateRecord(record, { expectedApprovalId: approvalId }));
      } catch (error) {
        scanned.push({
          status: "corrupt",
          approval_id: approvalId,
          path: filePath,
          reason: sanitizeReason(error?.message || "invalid paused sidecar")
        });
      }
    }

    return scanned.sort(compareScanned);
  }

  async function writeRawForTest(approvalId, raw) {
    const filePath = sidecarPath(approvalId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, raw);
  }

  return {
    baseDir,
    save,
    load,
    delete: deleteSidecar,
    consume,
    quarantine,
    scan,
    writeRawForTest
  };
}

function validateRecord(record, { expectedApprovalId = null } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("paused record is required");
  }

  const approval_id = requireSegment(record.approval_id, "approval_id");
  if (expectedApprovalId && approval_id !== expectedApprovalId) {
    throw new Error("approval_id must match sidecar path");
  }

  const schema_version = record.schema_version ?? SCHEMA_VERSION;
  if (schema_version !== SCHEMA_VERSION) throw new Error("unsupported paused sidecar schema_version");
  const turn_id = requireString(record.turn_id, "turn_id");
  const session_id = requireString(record.session_id, "session_id");
  const created_at = requireIsoTimestamp(record.created_at, "created_at");
  const surface = requireString(record.surface, "surface");
  if (!VALID_SURFACES.has(surface)) throw new Error("invalid paused sidecar surface");
  const permission_context = requireObject(record.permission_context, "permission_context");
  const approval = requireObject(record.approval, "approval");
  if (approval.id !== approval_id) throw new Error("approval.id must match approval_id");
  const turn = requireObject(record.turn, "turn");
  const resume_state = requireObject(record.resume_state, "resume_state");

  return {
    schema_version,
    approval_id,
    turn_id,
    session_id,
    created_at,
    surface,
    permission_context,
    approval,
    turn,
    resume_state
  };
}

function validateConsumedRecord(record, { expectedApprovalId = null, path = null } = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("paused consumed record is required");
  }

  const approval_id = requireSegment(record.approval_id, "approval_id");
  if (expectedApprovalId && approval_id !== expectedApprovalId) {
    throw new Error("approval_id must match sidecar path");
  }

  const schema_version = record.schema_version ?? SCHEMA_VERSION;
  if (schema_version !== SCHEMA_VERSION) throw new Error("unsupported paused sidecar schema_version");
  if (record.status !== "consumed") throw new Error("invalid paused consumed status");
  const consumed_at = requireIsoTimestamp(record.consumed_at, "consumed_at");

  return {
    schema_version,
    approval_id,
    status: "consumed",
    consumed_at,
    path,
    reason: sanitizeReason(record.reason || "consumed")
  };
}

function requireSegment(value, field) {
  if (!value) throw new Error(`${field} is required`);
  return safeRecoverySegment(value);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} is required`);
  return value;
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} is required`);
  return value;
}

function requireIsoTimestamp(value, field) {
  requireString(value, field);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
  return value;
}

function compareScanned(left, right) {
  const leftTime = left.created_at || "";
  const rightTime = right.created_at || "";
  if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
  return String(left.approval_id || "").localeCompare(String(right.approval_id || ""));
}

function sanitizeReason(reason) {
  const text = String(reason || "invalid paused sidecar");
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
