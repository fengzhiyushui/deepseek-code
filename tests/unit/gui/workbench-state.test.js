import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const state = require("../../../gui/renderer/workbench-state.js");

test("createInitialState defines workbench defaults", () => {
  const initial = state.createInitialState();

  assert.deepEqual(initial.branches, []);
  assert.deepEqual(initial.checkpoints, []);
  assert.equal(initial.activeBranchId, "br_main");
  assert.equal(initial.selectedBranchId, "br_main");
  assert.equal(initial.rewindPreview, null);
  assert.equal(initial.rewindResult, null);
  assert.equal(initial.forceRewind, false);
});

test("applyWorkbenchAction stores branches active branch and selected branch", () => {
  const initial = state.createInitialState();
  const next = state.applyWorkbenchAction(initial, {
    type: "branches_loaded",
    branches: [{ branch_id: "br_main" }, { branch_id: "br_child" }],
    activeBranchId: "br_child"
  });

  assert.equal(next.activeBranchId, "br_child");
  assert.equal(next.selectedBranchId, "br_child");
  assert.deepEqual(next.branches.map((branch) => branch.branch_id), ["br_main", "br_child"]);
  assert.notEqual(next, initial);
});

test("applyWorkbenchAction caps activity buffer without mutating previous state", () => {
  let current = state.createInitialState();
  for (let i = 0; i < 60; i++) {
    current = state.applyWorkbenchAction(current, { type: "event_received", event: { type: "tool:call", seq: i } });
  }

  assert.equal(current.activity.length, 50);
  assert.equal(current.activity[0].seq, 10);
  assert.equal(state.createInitialState().activity.length, 0);
});

test("checkpoint target and rewind preview/result are stored predictably", () => {
  const cp = { checkpoint_id: "cp_1", turn_id: "turn_1", event_id: "evt_1", seq: 7 };
  const preview = { status: "success", rollback_count: 2, files: ["a.txt"], target: { turn_id: "turn_1" } };
  const result = { status: "failed_restored", reason: "branch_create_failed" };
  const selected = state.applyWorkbenchAction(state.createInitialState(), { type: "checkpoint_selected", checkpoint: cp });
  const withPreview = state.applyWorkbenchAction(selected, { type: "rewind_preview_loaded", preview });
  const withResult = state.applyWorkbenchAction(withPreview, { type: "rewind_result_loaded", result });

  assert.deepEqual(selected.selectedTarget, { turn_id: "turn_1" });
  assert.equal(withPreview.rewindPreview.rollback_count, 2);
  assert.equal(withResult.rewindResult.status, "failed_restored");
});

test("format helpers produce compact labels", () => {
  assert.equal(state.shortId("br_abcdef123456"), "br_abcd");
  assert.equal(state.formatRewindStatus({ status: "success" }), "Rewind applied. New branch active.");
  assert.equal(state.formatRewindStatus({ status: "conflict_restored" }), "Rewind blocked; previous changes were restored.");
  assert.equal(state.formatRewindStatus({ status: "failed_unrestorable" }), "Rewind recovery failed. Manual check required.");
  assert.equal(state.formatTokenCount(1250), "1.3K");
  assert.equal(state.formatCacheRate({ cache_hit_rate: 0.456 }), "46%");
  assert.equal(state.formatLatency({ avg_latency_ms: 1234 }), "1.2s");
});
