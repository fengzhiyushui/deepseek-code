import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORCH_RECOVERY_SCHEMA_VERSION, ORCH_FINGERPRINTS,
  fingerprintsMatch, isOrchestrationWorkerSidecar, ownershipOk
} from "../../../src/core/orchestration/orchestration-recovery-contract.js";

function workerRecord({ approvalId = "ap1", taskId = "task_1", sessionId = "session", subtaskId = "a", marker = true } = {}) {
  return {
    approval_id: approvalId,
    resume_state: { options: marker ? { __orchestration: { taskId, sessionId, subtaskId } } : {} }
  };
}
function sidecar(over = {}) {
  return { approvalId: "ap1", taskId: "task_1", sessionId: "session", pausedSubtask: { id: "a" }, ...over };
}

test("schema version + fingerprints are the pinned current values", () => {
  assert.equal(ORCH_RECOVERY_SCHEMA_VERSION, 1);
  assert.deepEqual({ ...ORCH_FINGERPRINTS }, { workerFactory: 1, toolSubset: 1, subtaskSchema: 1 });
});

test("fingerprintsMatch: exact match only", () => {
  assert.equal(fingerprintsMatch({ workerFactory: 1, toolSubset: 1, subtaskSchema: 1 }), true);
  assert.equal(fingerprintsMatch({ workerFactory: 2, toolSubset: 1, subtaskSchema: 1 }), false);
  assert.equal(fingerprintsMatch({ workerFactory: 1, toolSubset: 1 }), false);               // missing key
  assert.equal(fingerprintsMatch({ workerFactory: 1, toolSubset: 1, subtaskSchema: 1, extra: 9 }), false);
  assert.equal(fingerprintsMatch(null), false);
});

test("isOrchestrationWorkerSidecar reads the __orchestration marker", () => {
  assert.equal(isOrchestrationWorkerSidecar(workerRecord({ marker: true })), true);
  assert.equal(isOrchestrationWorkerSidecar(workerRecord({ marker: false })), false);
  assert.equal(isOrchestrationWorkerSidecar({}), false);
  assert.equal(isOrchestrationWorkerSidecar(null), false);
});

test("ownershipOk: passes only when key + task + session + subtask + marker all align (CST-7)", () => {
  assert.equal(ownershipOk({ sidecar: sidecar(), workerRecord: workerRecord() }), true);
  assert.equal(ownershipOk({ sidecar: sidecar({ approvalId: "other" }), workerRecord: workerRecord() }), false);
  assert.equal(ownershipOk({ sidecar: sidecar({ taskId: "task_other" }), workerRecord: workerRecord() }), false);
  assert.equal(ownershipOk({ sidecar: sidecar({ sessionId: "other" }), workerRecord: workerRecord() }), false);
  assert.equal(ownershipOk({ sidecar: sidecar({ pausedSubtask: { id: "b" } }), workerRecord: workerRecord() }), false);
  assert.equal(ownershipOk({ sidecar: sidecar(), workerRecord: workerRecord({ marker: false }) }), false);  // wrong owner type
});
