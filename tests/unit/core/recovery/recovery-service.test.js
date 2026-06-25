import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryService } from "../../../../src/core/recovery/recovery-service.js";

test("recovery service rehydrates valid paused records", async () => {
  const restored = [];
  const events = [];
  const inboxItems = [];
  const service = createRecoveryService({
    projectId: "proj_1",
    lock: { assertOwner: async () => {}, epoch: 1 },
    paused: {
      baseDir: ".deepseek-code/v2/sessions/proj_1/paused",
      scan: async () => [
        {
          approval_id: "approval_1",
          turn_id: "turn_1",
          session_id: "sess_1",
          surface: "cli",
          permission_context: { autonomy: "supervised" },
          approval: { id: "approval_1", summary: "edit file" },
          turn: { id: "turn_1", autonomy: "supervised" },
          resume_state: {}
        }
      ]
    },
    pausedTurnStore: { restore: (record) => restored.push(record) },
    inbox: {
      upsert: async (item) => { inboxItems.push(item); },
      list: async () => inboxItems
    },
    appendMarker: async (type, data) => events.push([type, data])
  });

  const report = await service.recoverOnStartup();

  assert.equal(restored[0].approval_id, "approval_1");
  assert.equal(inboxItems[0].type, "paused_turn");
  assert.equal(inboxItems[0].status, "pending");
  assert.equal(report.found.length, 1);
  assert.equal(report.done.length, 1);
  assert.equal(report.next.length, 1);
  assert.ok(events.some(([type]) => type === "recovery:started"));
  assert.ok(events.some(([type]) => type === "turn:rehydrated"));
  assert.ok(events.some(([type]) => type === "recovery:report"));
});

test("recovery service blocks on corrupt paused sidecars", async () => {
  const events = [];
  const inboxItems = [];
  const service = createRecoveryService({
    projectId: "proj_1",
    lock: { assertOwner: async () => {}, epoch: 1 },
    paused: {
      baseDir: ".deepseek-code/v2/sessions/proj_1/paused",
      scan: async () => [
        { status: "corrupt", approval_id: "bad_1", path: "/path/bad_1.json", reason: "invalid json" }
      ]
    },
    pausedTurnStore: { restore: () => {} },
    inbox: {
      upsert: async (item) => { inboxItems.push(item); },
      list: async () => inboxItems
    },
    appendMarker: async (type, data) => events.push([type, data])
  });

  const report = await service.recoverOnStartup();

  assert.equal(inboxItems[0].type, "blocked_recovery");
  assert.equal(inboxItems[0].status, "blocked");
  assert.equal(report.blocked.length, 1);
  assert.ok(events.some(([type]) => type === "recovery:blocked"));
});

test("recovery service skips consumed paused sidecars", async () => {
  const restored = [];
  const inboxItems = [];
  const service = createRecoveryService({
    projectId: "proj_1",
    lock: { assertOwner: async () => {}, epoch: 1 },
    paused: {
      baseDir: ".deepseek-code/v2/sessions/proj_1/paused",
      scan: async () => [
        { status: "consumed", approval_id: "consumed_1" }
      ]
    },
    pausedTurnStore: { restore: (record) => restored.push(record) },
    inbox: {
      upsert: async (item) => { inboxItems.push(item); },
      list: async () => inboxItems
    },
    appendMarker: async () => {}
  });

  const report = await service.recoverOnStartup();

  assert.equal(restored.length, 0);
  assert.equal(inboxItems.length, 0);
  assert.equal(report.found.length, 0);
});

test("recovery service resume delegates to runtime", async () => {
  const calls = [];
  const service = createRecoveryService({
    projectId: "proj_1",
    lock: { assertOwner: async () => {}, epoch: 1 },
    paused: { scan: async () => [] },
    pausedTurnStore: {},
    inbox: {
      upsert: async () => {},
      list: async () => [],
      get: async (id) => ({ id, type: "paused_turn", status: "pending" }),
      mark: async () => {}
    },
    appendMarker: async () => {},
    resumePaused: async (approvalId, decision) => {
      calls.push(["resume", approvalId, decision]);
      return { status: "complete" };
    }
  });

  await service.recoverOnStartup();
  const result = await service.resume("rec_pause_approval_1", { decision: "approve" });

  assert.deepEqual(calls, [["resume", "approval_1", "approve"]]);
  assert.equal(result.status, "resumed");
});

test("recovery service cancel delegates to runtime", async () => {
  const calls = [];
  const service = createRecoveryService({
    projectId: "proj_1",
    lock: { assertOwner: async () => {}, epoch: 1 },
    paused: { scan: async () => [] },
    pausedTurnStore: {},
    inbox: {
      upsert: async () => {},
      list: async () => [],
      get: async (id) => ({ id, type: "paused_turn", status: "pending" }),
      mark: async () => {}
    },
    appendMarker: async () => {},
    cancelPaused: async (approvalId) => {
      calls.push(["cancel", approvalId]);
      return { status: "cancelled" };
    }
  });

  await service.recoverOnStartup();
  const result = await service.cancel("rec_pause_approval_1");

  assert.deepEqual(calls, [["cancel", "approval_1"]]);
  assert.equal(result.status, "cancelled");
});
