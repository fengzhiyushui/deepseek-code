import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryService } from "../../../../src/core/recovery/recovery-service.js";
import { serializeOrchestrationState } from "../../../../src/core/orchestration/orchestration-recovery-contract.js";

function noBudget() { return { snapshot: () => ({ tokens: 0, model_calls: 0, max_tokens: null, max_model_calls: null }) }; }
function orchSidecar({ approvalId = "ap_orch", taskId = "task_1", sessionId = "s", subtaskId = "a" } = {}) {
  const state = { message: "m", done_when: "d", options: { autonomy: "gated", sessionId }, plan: { subtasks: [] }, round: 1, allCollected: [],
    seenSubtaskIds: new Set(), seenFp: new Set(), budget: noBudget(), adoptedExperienceIds: [], riskCues: new Set(), taskId, sessionId, env: { root: "/r", orchestrationConfig: {} } };
  return serializeOrchestrationState(state, { approvalId, pausedSubtask: { id: subtaskId, goal: "g", acceptance: [], context_scope: {}, tool_profile: "edit", depends_on: [] }, remaining: [] });
}
function workerRec({ approvalId = "ap_orch", taskId = "task_1", sessionId = "s", subtaskId = "a", marker = true } = {}) {
  return { approval_id: approvalId, turn_id: "t", session_id: sessionId, surface: "cli", approval: { id: approvalId, summary: "edit" }, turn: {}, permission_context: {}, resume_state: { options: marker ? { __orchestration: { taskId, sessionId, subtaskId } } : {} } };
}
function fakeInbox(items) {
  return {
    upsert: async (it) => { const i = items.findIndex((x) => x.id === it.id); if (i >= 0) items[i] = { ...items[i], ...it }; else items.push({ ...it }); },
    list: async () => items, get: async (id) => items.find((x) => x.id === id) || null,
    mark: async (id, patch) => { const it = items.find((x) => x.id === id); if (it) Object.assign(it, patch); }
  };
}
function svc({ pausedScan = [], orchScan = [], restored = [], items = [], resumeOrchestration = null }) {
  return createRecoveryService({
    projectId: "proj", lock: { assertOwner: async () => {}, epoch: 1 },
    paused: { baseDir: "/base", scan: async () => pausedScan, quarantine: async () => ({ status: "quarantined" }) },
    orchPersistence: { scan: async () => orchScan, consume: async () => {}, quarantine: async () => ({ status: "quarantined" }) },
    pausedTurnStore: { restore: (r) => restored.push(r), list: () => [] },
    inbox: fakeInbox(items), appendMarker: async () => {}, resumeOrchestration
  });
}

test("matched orchestration sidecar + worker -> orchestration_paused inbox, worker restored", async () => {
  const restored = [], items = [];
  await svc({ pausedScan: [workerRec()], orchScan: [orchSidecar()], restored, items }).recoverOnStartup();
  const item = items.find((x) => x.id === "rec_orch_ap_orch");
  assert.equal(item.type, "orchestration_paused");
  assert.equal(item.status, "pending");
  assert.deepEqual(item.allowed_actions, ["resume", "cancel"]);
  assert.equal(restored.some((r) => r.approval_id === "ap_orch"), true);
});

test("orphan orchestration worker (no orchestration sidecar) -> blocked, NEVER single-agent (CST-4)", async () => {
  const restored = [], items = [];
  await svc({ pausedScan: [workerRec({ approvalId: "ap_orphan", subtaskId: "a" })], orchScan: [], restored, items }).recoverOnStartup();
  const item = items.find((x) => x.id === "rec_pause_ap_orphan");
  assert.equal(item.type, "blocked_recovery");
  assert.equal(item.status, "blocked");
  assert.deepEqual(item.allowed_actions, ["cancel"]);
  assert.equal(restored.length, 0);
});

test("orchestration sidecar with fingerprint mismatch -> blocked (CST-6)", async () => {
  const items = [];
  const bad = orchSidecar(); bad.fingerprints = { workerFactory: 9, toolSubset: 1, subtaskSchema: 1 };
  await svc({ pausedScan: [workerRec()], orchScan: [bad], items }).recoverOnStartup();
  assert.equal(items.find((x) => x.id === "rec_orch_ap_orch").type, "blocked_recovery");
});

test("plain single-agent sidecar (no marker) still restores as paused_turn (no regression)", async () => {
  const restored = [], items = [];
  await svc({ pausedScan: [workerRec({ approvalId: "ap_single", marker: false })], orchScan: [], restored, items }).recoverOnStartup();
  assert.equal(items.find((x) => x.id === "rec_pause_ap_single").type, "paused_turn");
  assert.equal(restored.some((r) => r.approval_id === "ap_single"), true);
});

test("resume(rec_orch_...) routes to resumeOrchestration", async () => {
  const calls = [];
  const items = [{ id: "rec_orch_ap_orch", type: "orchestration_paused", status: "pending", source_id: "ap_orch" }];
  const s = svc({ items, resumeOrchestration: async (approvalId, decision) => { calls.push([approvalId, decision]); return { status: "complete" }; } });
  const res = await s.resume("rec_orch_ap_orch", { decision: "approve" });
  assert.deepEqual(calls, [["ap_orch", "approve"]]);
  assert.equal(res.status, "resumed");
});
