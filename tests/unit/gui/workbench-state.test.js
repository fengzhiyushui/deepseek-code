import test from "node:test";
import assert from "node:assert/strict";
import * as state from "../../../gui/src/state/workbench-state.js";

test("createInitialState defines workbench defaults", () => {
  const initial = state.createInitialState();

  assert.deepEqual(initial.branches, []);
  assert.deepEqual(initial.checkpoints, []);
  assert.equal(initial.activeBranchId, "br_main");
  assert.equal(initial.selectedBranchId, "br_main");
  assert.equal(initial.rewindPreview, null);
  assert.equal(initial.rewindResult, null);
  assert.equal(initial.forceRewind, false);
  assert.equal(initial.railMode, "chat");
  assert.equal(initial.contextCollapsed, false);
  assert.equal(initial.inspectorMode, "activity");
  assert.equal(initial.theme, "night");
  assert.equal(initial.emptyStateVisible, true);
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

test("runtime error and loading actions expose degraded workbench state", () => {
  const initial = state.createInitialState();
  const loading = state.applyWorkbenchAction(initial, { type: "loading_changed", key: "branches", value: true });
  const failed = state.applyWorkbenchAction(loading, { type: "error_reported", area: "branches", message: "branch api failed" });

  assert.deepEqual(loading.loading, { branches: true });
  assert.equal(failed.loading.branches, false);
  assert.deepEqual(failed.errors, [{ area: "branches", message: "branch api failed" }]);
  assert.equal(failed.degraded, true);
});

test("error_reported caps errors and redacts empty messages", () => {
  let current = state.createInitialState();
  for (let i = 0; i < 8; i++) {
    current = state.applyWorkbenchAction(current, { type: "error_reported", area: "api", message: i === 0 ? "" : `error ${i}` });
  }

  assert.equal(current.errors.length, 5);
  assert.equal(current.errors[0].message, "error 3");
  assert.equal(current.degraded, true);
});

test("message activity and presentation actions update workbench state", () => {
  let current = state.createInitialState();
  current = state.applyWorkbenchAction(current, { type: "message_added", message: { role: "user", content: "inspect README" } });
  current = state.applyWorkbenchAction(current, { type: "rail_mode_changed", mode: "branches" });
  current = state.applyWorkbenchAction(current, { type: "context_collapsed_changed", collapsed: true });
  current = state.applyWorkbenchAction(current, { type: "inspector_mode_changed", mode: "checkpoints" });
  current = state.applyWorkbenchAction(current, { type: "theme_changed", theme: "day" });

  assert.equal(current.emptyStateVisible, false);
  assert.equal(current.railMode, "branches");
  assert.equal(current.contextCollapsed, true);
  assert.equal(current.inspectorMode, "checkpoints");
  assert.equal(current.theme, "day");
  assert.equal(state.statusSummary(current).runtime, "idle");
  assert.equal(state.statusSummary(current).branch, "br_main");
});

test("traffic helpers map runtime health to a small traffic-light vocabulary with labels", () => {
  assert.equal(state.trafficTone({ runtime: { current: "idle" } }), "ready");
  assert.equal(state.trafficTone({ runtime: { current: "complete" } }), "ready");
  assert.equal(state.trafficTone({ runtime: { current: "acting" } }), "working");
  assert.equal(state.trafficTone({ runtime: { current: "awaiting_approval" } }), "working");
  assert.equal(state.trafficTone({ runtime: { current: "error" } }), "error");
  assert.equal(state.trafficTone({ degraded: true, runtime: { current: "idle" } }), "error");
  assert.equal(state.trafficTone({ runtime: { current: "offline" } }), "offline");
  assert.equal(state.trafficLabel("ready", { runtime: { current: "idle" } }), "Ready");
  assert.equal(state.trafficLabel("working", { runtime: { current: "awaiting_approval" } }), "Approval");
  assert.equal(state.trafficLabel("error", { degraded: true }), "Error");
  assert.equal(state.trafficLabel("offline", {}), "Offline");
});

test("risk events move focus to contextual inspector modes", () => {
  let current = state.createInitialState();
  current = state.applyWorkbenchAction(current, { type: "event_received", event: { type: "approval:requested", approval: { id: "ap_1" } } });
  assert.equal(current.inspectorMode, "approval");

  current = state.applyWorkbenchAction(current, { type: "checkpoint_selected", checkpoint: { turn_id: "turn_1", seq: 3 } });
  assert.equal(current.inspectorMode, "rewind");

  current = state.applyWorkbenchAction(current, { type: "event_received", event: { type: "agent:error", message: "failed" } });
  assert.equal(current.inspectorMode, "details");
});

test("invalid presentation choices fall back to safe defaults", () => {
  let current = state.createInitialState();
  current = state.applyWorkbenchAction(current, { type: "rail_mode_changed", mode: "nonsense" });
  current = state.applyWorkbenchAction(current, { type: "inspector_mode_changed", mode: "nonsense" });
  current = state.applyWorkbenchAction(current, { type: "theme_changed", theme: "neon" });

  assert.equal(current.railMode, "chat");
  assert.equal(current.inspectorMode, "activity");
  assert.equal(current.theme, "night");
  assert.equal(state.themeLabel("day"), "Day Review");
  assert.equal(state.themeLabel("night"), "Night Workbench");
});

test("preferences_loaded hydrates only safe presentation fields", () => {
  const current = state.applyWorkbenchAction(state.createInitialState(), {
    type: "preferences_loaded",
    preferences: {
      theme: "day",
      railMode: "timeline",
      contextCollapsed: true,
      messages: [{ role: "user", content: "ignored" }]
    }
  });

  assert.equal(current.theme, "day");
  assert.equal(current.railMode, "timeline");
  assert.equal(current.contextCollapsed, true);
  assert.deepEqual(current.messages, []);
});

test("inspector_closed returns to activity without clearing selected checkpoint", () => {
  const cp = { turn_id: "turn_1", seq: 4 };
  const selected = state.applyWorkbenchAction(state.createInitialState(), { type: "checkpoint_selected", checkpoint: cp });
  const closed = state.applyWorkbenchAction(selected, { type: "inspector_closed" });

  assert.equal(selected.inspectorMode, "rewind");
  assert.equal(closed.inspectorMode, "activity");
  assert.deepEqual(closed.selectedCheckpoint, cp);
});

// D1-M1: immutability guards (React useReducer relies on new references)
test("state-changing actions return a NEW reference", () => {
  const s0 = state.createInitialState();
  const mutating = [
    { type: "message_added", message: { role: "user", text: "hi" } },
    { type: "event_received", event: { type: "agent:step" } },
    { type: "theme_changed", theme: "day" },
    { type: "branch_selected", branch_id: "br_x" },
    { type: "rail_mode_changed", mode: "timeline" }
  ];
  let prev = s0;
  for (const a of mutating) {
    const next = state.applyWorkbenchAction(prev, a);
    assert.notEqual(next, prev, a.type + " must return new ref");
    prev = next;
  }
});

test("does not mutate the previous state in place", () => {
  const s0 = state.createInitialState();
  const before = JSON.stringify(s0);
  state.applyWorkbenchAction(s0, { type: "message_added", message: { text: "x" } });
  assert.equal(JSON.stringify(s0), before);
});

test("unknown/no-op action returns the SAME reference", () => {
  const s0 = state.createInitialState();
  assert.equal(state.applyWorkbenchAction(s0, { type: "___nope___" }), s0);
  assert.equal(state.applyWorkbenchAction(s0, {}), s0);
});
