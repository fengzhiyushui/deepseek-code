import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicReadJson, atomicWriteJson, safeRecoverySegment } from "./atomic-file.js";
import { createRecoveryFaults } from "./recovery-faults.js";
import { validateOrchestrationSidecar, ORCH_RECOVERY_SCHEMA_VERSION } from "../orchestration/orchestration-recovery-contract.js";

export function createOrchestrationPersistence({ root, projectId, faults = createRecoveryFaults() }) {
  if (!root) throw new Error("root is required");
  const projectSegment = safeRecoverySegment(projectId);
  const baseDir = path.join(root, ".deepseek-code", "v2", "sessions", projectSegment, "orchestration-paused");
  const quarantineDir = path.join(baseDir, "quarantine");

  const sidecarPath = (approvalId) => path.join(baseDir, `${safeRecoverySegment(approvalId)}.json`);

  async function save(approvalId, state) {
    const id = safeRecoverySegment(approvalId);
    const check = validateOrchestrationSidecar(state);
    if (!check.ok) throw new Error(`invalid orchestration sidecar: ${check.error}`);
    if (state.approvalId !== id) throw new Error("approvalId must match sidecar path");
    await atomicWriteJson(sidecarPath(id), state);
    await faults.maybe("after-orchestration-sidecar-write");
    return state;
  }

  async function load(approvalId) {
    const id = safeRecoverySegment(approvalId);
    const record = await atomicReadJson(sidecarPath(id));
    if (record?.status === "consumed") return { status: "consumed", approvalId: id };
    const check = validateOrchestrationSidecar(record);
    if (!check.ok) throw new Error(`invalid orchestration sidecar: ${check.error}`);
    if (record.approvalId !== id) throw new Error("approvalId must match sidecar path");
    return record;
  }

  async function deleteSidecar(approvalId) {
    try { await unlink(sidecarPath(approvalId)); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }

  async function consume(approvalId) {
    const id = safeRecoverySegment(approvalId);
    const filePath = sidecarPath(id);
    const consumed = { schemaVersion: ORCH_RECOVERY_SCHEMA_VERSION, approvalId: id, status: "consumed", consumed_at: new Date().toISOString(), reason: "consumed" };
    try {
      await atomicWriteJson(filePath, consumed);
    } catch (writeError) {
      const deleted = await deleteSidecar(id).catch(() => false);
      return { status: deleted ? "deleted" : "missing", approvalId: id, path: filePath, reason: sanitizeReason(writeError?.message) };
    }
    try {
      const deleted = await deleteSidecar(id);
      return { status: deleted ? "deleted" : "missing", approvalId: id, path: filePath };
    } catch (error) {
      const reason = sanitizeReason(error?.message);
      await atomicWriteJson(filePath, { ...consumed, reason }).catch(() => {});
      return { status: "consumed", approvalId: id, path: filePath, reason };
    }
  }

  async function quarantine(approvalId, reason = "quarantined") {
    const id = safeRecoverySegment(approvalId);
    const source = sidecarPath(id);
    const target = path.join(quarantineDir, `${id}.json`);
    try {
      await mkdir(quarantineDir, { recursive: true });
      await rename(source, target);
      return { status: "quarantined", approvalId: id, path: target, reason: sanitizeReason(reason) };
    } catch (error) {
      if (error?.code === "ENOENT") return { status: "missing", approvalId: id, path: source, reason: "sidecar not found" };
      throw error;
    }
  }

  async function scan() {
    let entries;
    try { entries = await readdir(baseDir, { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    const scanned = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const approvalId = entry.name.slice(0, -".json".length);
      const filePath = path.join(baseDir, entry.name);
      try {
        safeRecoverySegment(approvalId);
        const record = await atomicReadJson(filePath);
        if (record?.status === "consumed") { scanned.push({ status: "consumed", approvalId, path: filePath }); continue; }
        const check = validateOrchestrationSidecar(record);
        if (!check.ok) { scanned.push({ status: "corrupt", approvalId, path: filePath, reason: check.error }); continue; }
        if (record.approvalId !== approvalId) { scanned.push({ status: "corrupt", approvalId, path: filePath, reason: "approvalId mismatch" }); continue; }
        scanned.push(record);
      } catch (error) {
        scanned.push({ status: "corrupt", approvalId, path: filePath, reason: sanitizeReason(error?.message || "invalid orchestration sidecar") });
      }
    }
    return scanned.sort((a, b) => String(a.approvalId).localeCompare(String(b.approvalId)));
  }

  async function writeRawForTest(approvalId, raw) {
    const filePath = sidecarPath(approvalId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, raw);
  }

  return { baseDir, save, load, delete: deleteSidecar, consume, quarantine, scan, writeRawForTest };
}

function sanitizeReason(reason) {
  const text = String(reason || "invalid orchestration sidecar");
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
