// Pure contract layer for durable orchestration recovery. No I/O, no live objects.
// Every function operates on plain serializable data so it is unit-testable in isolation.

export const ORCH_RECOVERY_SCHEMA_VERSION = 1;

// Version fingerprints of the code a rebuilt worker's byte-equivalence depends on.
// Bump the relevant field when that logic changes incompatibly:
//   workerFactory -> worker-factory.js rebuild wiring;  toolSubset -> tool-profiles.js filtering;
//   subtaskSchema -> subtask-schema.js SubTask shape.
export const ORCH_FINGERPRINTS = Object.freeze({ workerFactory: 1, toolSubset: 1, subtaskSchema: 1 });

export function fingerprintsMatch(sidecarFingerprints) {
  if (!sidecarFingerprints || typeof sidecarFingerprints !== "object") return false;
  const keys = Object.keys(ORCH_FINGERPRINTS);
  if (Object.keys(sidecarFingerprints).length !== keys.length) return false;
  return keys.every((k) => sidecarFingerprints[k] === ORCH_FINGERPRINTS[k]);
}

export function isOrchestrationWorkerSidecar(workerRecord) {
  return !!workerRecord?.resume_state?.options?.__orchestration;
}

export function ownershipOk({ sidecar, workerRecord }) {
  if (!sidecar || !workerRecord) return false;
  const marker = workerRecord.resume_state?.options?.__orchestration;
  if (!marker) return false;                                     // turn owner type must be orchestration-owned
  if (sidecar.approvalId !== workerRecord.approval_id) return false;   // same-key correlation
  if (sidecar.taskId !== marker.taskId) return false;
  if (sidecar.sessionId !== marker.sessionId) return false;
  if (!sidecar.pausedSubtask || sidecar.pausedSubtask.id !== marker.subtaskId) return false;
  return true;
}
