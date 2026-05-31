// gui/renderer/workbench-state.js — Pure workbench state model
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DeepSeekWorkbenchState = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createInitialState() {
    return {
      messages: [],
      activity: [],
      branches: [],
      checkpoints: [],
      activeBranchId: "br_main",
      selectedBranchId: "br_main",
      selectedCheckpoint: null,
      selectedTarget: null,
      rewindPreview: null,
      rewindResult: null,
      forceRewind: false,
      usage: null,
      metrics: {
        tokens: "0",
        cacheRate: "0%",
        latency: "0ms",
        requests: "0"
      },
      runtime: { current: "idle", channel: null },
      statusChannel: "idle"
    };
  }

  function applyWorkbenchAction(state, action) {
    var current = state || createInitialState();
    if (!action || !action.type) return current;
    if (action.type === "message_added") {
      return copy(current, { messages: current.messages.concat([action.message]) });
    }
    if (action.type === "event_received") {
      return copy(current, { activity: current.activity.concat([action.event]).slice(-50) });
    }
    if (action.type === "branches_loaded") {
      var active = action.activeBranchId || current.activeBranchId || "br_main";
      return copy(current, {
        branches: Array.isArray(action.branches) ? action.branches.slice() : [],
        activeBranchId: active,
        selectedBranchId: action.selectedBranchId || active
      });
    }
    if (action.type === "branch_selected") {
      return copy(current, {
        selectedBranchId: action.branch_id || "br_main",
        selectedCheckpoint: null,
        selectedTarget: null,
        rewindPreview: null,
        rewindResult: null
      });
    }
    if (action.type === "checkpoints_loaded") {
      return copy(current, { checkpoints: Array.isArray(action.checkpoints) ? action.checkpoints.slice() : [] });
    }
    if (action.type === "checkpoint_selected") {
      var checkpoint = action.checkpoint || null;
      return copy(current, {
        selectedCheckpoint: checkpoint,
        selectedTarget: targetFromCheckpoint(checkpoint),
        rewindPreview: null,
        rewindResult: null
      });
    }
    if (action.type === "rewind_preview_loaded") {
      return copy(current, { rewindPreview: action.preview || null, rewindResult: null });
    }
    if (action.type === "rewind_result_loaded") {
      return copy(current, { rewindResult: action.result || null });
    }
    if (action.type === "force_rewind_changed") {
      return copy(current, { forceRewind: Boolean(action.force) });
    }
    if (action.type === "usage_loaded") {
      return copy(current, {
        usage: action.usage || null,
        metrics: metricsFromUsage(action.usage || {})
      });
    }
    if (action.type === "runtime_loaded") {
      return copy(current, { runtime: action.runtime || { current: "idle", channel: null } });
    }
    if (action.type === "status_channel_changed") {
      return copy(current, { statusChannel: action.channel || current.statusChannel });
    }
    return current;
  }

  function targetFromCheckpoint(checkpoint) {
    if (!checkpoint) return null;
    if (checkpoint.turn_id) return { turn_id: checkpoint.turn_id };
    if (checkpoint.event_id) return { event_id: checkpoint.event_id };
    return { seq: checkpoint.seq };
  }

  function shortId(value) {
    var text = String(value || "");
    if (text.indexOf("br_") === 0) return text.slice(0, 7);
    if (text.length <= 10) return text;
    return text.slice(0, 10);
  }

  function formatRewindStatus(result) {
    if (!result) return "";
    if (result.status === "success") return "Rewind applied. New branch active.";
    if (result.status === "conflict") return "Rewind blocked by dirty files.";
    if (result.status === "conflict_restored") return "Rewind blocked; previous changes were restored.";
    if (result.status === "failed_restored") return "Rewind failed; workspace was restored.";
    if (result.status === "failed_unrestorable") return "Rewind recovery failed. Manual check required.";
    return "Rewind status: " + (result.status || "unknown");
  }

  function metricsFromUsage(usage) {
    return {
      tokens: formatTokenCount(usage.total_tokens || ((usage.total_prompt_tokens || 0) + (usage.total_completion_tokens || 0))),
      cacheRate: formatCacheRate(usage),
      latency: formatLatency(usage),
      requests: String(usage.requests || 0)
    };
  }

  function formatTokenCount(value) {
    var count = Number(value || 0);
    return count >= 1000 ? (count / 1000).toFixed(1) + "K" : String(count);
  }

  function formatCacheRate(usage) {
    if (typeof usage.cache_hit_rate === "number") return Math.round(usage.cache_hit_rate * 100) + "%";
    var hits = usage.cache_hit_tokens || 0;
    var misses = usage.cache_miss_tokens || 0;
    var denom = hits + misses;
    return denom > 0 ? Math.round(hits / denom * 100) + "%" : "0%";
  }

  function formatLatency(usage) {
    var ms = Number(usage.avg_latency_ms || 0);
    if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
    return Math.round(ms) + "ms";
  }

  function copy(base, patch) {
    var next = {};
    Object.keys(base).forEach(function (key) { next[key] = base[key]; });
    Object.keys(patch).forEach(function (key) { next[key] = patch[key]; });
    return next;
  }

  return {
    createInitialState: createInitialState,
    applyWorkbenchAction: applyWorkbenchAction,
    targetFromCheckpoint: targetFromCheckpoint,
    shortId: shortId,
    formatRewindStatus: formatRewindStatus,
    metricsFromUsage: metricsFromUsage,
    formatTokenCount: formatTokenCount,
    formatCacheRate: formatCacheRate,
    formatLatency: formatLatency
  };
}));
