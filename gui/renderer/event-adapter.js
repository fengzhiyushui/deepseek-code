// gui/renderer/event-adapter.js
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DeepSeekEventAdapter = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function eventIcon(type) {
    var icons = {
      "user:message": "U",
      "agent:turn_started": "S",
      "model:request": "M",
      "model:response": "M",
      "tool:call": "T",
      "tool:result": "R",
      "permission:decision": "P",
      "approval:requested": "A",
      "approval:resolved": "A",
      "file:diff_preview": "D",
      "file:diff_applied": "D",
      "file:rollback_applied": "B",
      "verification:result": "V",
      "agent:final": "F",
      "agent:result": "F",
      "agent:error": "E",
      "session:branch_created": "B",
      "session:branch_activated": "B",
      "session:rewind_preview": "W",
      "session:rewind_started": "W",
      "session:rewind_applied": "W",
      "session:rewind_conflict": "!",
      "session:rewind_failed": "!",
      "session:rewind_restore_started": "W",
      "session:rewind_restored": "W",
      "session:rewind_recovery_failed": "!"
    };
    return icons[type] || "-";
  }

  function summarizeEvent(event) {
    if (!event) return "";
    if (event.type === "user:message") return clip(event.content || "");
    if (event.type === "tool:call") return "tool " + (event.call?.name || event.tool || "unknown");
    if (event.type === "tool:result") return "tool result " + (event.result?.status || event.status || "unknown");
    if (event.type === "permission:decision") return "permission " + (event.permission?.decision || event.decision || "unknown");
    if (event.type === "approval:requested") return "approval " + (event.approval?.summary || event.approval?.id || "");
    if (event.type === "file:diff_preview") return "diff preview";
    if (event.type === "file:diff_applied") return "diff applied " + (event.change_id || event.record?.id || "");
    if (event.type === "file:rollback_applied") return "rollback " + (event.change_id || event.record?.id || "");
    if (event.type === "verification:result") return "verification " + (event.result?.status || event.status || "unknown");
    if (event.type === "agent:final") return clip(event.content || "complete");
    if (event.type === "agent:result") return event.result?.status || "complete";
    if (event.type === "agent:error") return "error " + (event.error || event.message || "");
    if (event.type === "session:branch_created") return "branch created " + (event.branch_id || "unknown");
    if (event.type === "session:branch_activated") return "branch active " + (event.branch_id || "unknown");
    if (event.type === "session:rewind_preview") return "rewind preview " + (event.rollback_count || event.rollback_change_ids?.length || 0) + " changes";
    if (event.type === "session:rewind_started") return "rewind started " + ((event.rollback_change_ids || []).length) + " changes";
    if (event.type === "session:rewind_applied") return "rewind applied " + (event.branch_id || "unknown");
    if (event.type === "session:rewind_conflict") return "rewind conflict " + (event.failed_change_id || "unknown");
    if (event.type === "session:rewind_failed") return "rewind failed " + (event.reason || event.failed_change_id || "unknown");
    if (event.type === "session:rewind_restore_started") return "rewind restoring " + ((event.applied_rollbacks || []).length) + " changes";
    if (event.type === "session:rewind_restored") return "rewind restored " + ((event.restored_files || []).length) + " files";
    if (event.type === "session:rewind_recovery_failed") return "rewind recovery failed " + (event.reason || event.restore_error || "unknown");
    return event.type || "event";
  }

  function getApproval(event) {
    if (event?.type !== "approval:requested" || !event.approval) return null;
    return {
      id: event.approval.id || "approval",
      summary: event.approval.summary || "Approval required"
    };
  }

  function statusFromEvent(event) {
    if (!event) return {};
    if (event.type === "model:request") return { channel: event.purpose || "model" };
    if (event.type === "tool:call") return { channel: "tool" };
    if (event.type === "verification:result") return { channel: "verify" };
    if (event.type === "agent:final" || event.type === "agent:result") return { channel: "idle" };
    if (event.type === "agent:error") return { channel: "error" };
    if (event.type === "session:rewind_preview" || event.type === "session:rewind_started" || event.type === "session:rewind_applied") return { channel: "rewind" };
    if (event.type === "session:rewind_conflict" || event.type === "session:rewind_failed" || event.type === "session:rewind_recovery_failed") return { channel: "recovery" };
    return {};
  }

  function clip(value, max) {
    var limit = max || 80;
    var text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
  }

  return { eventIcon: eventIcon, summarizeEvent: summarizeEvent, getApproval: getApproval, statusFromEvent: statusFromEvent };
}));
