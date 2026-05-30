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
      "agent:error": "E"
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
    return {};
  }

  function clip(value, max) {
    var limit = max || 80;
    var text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
  }

  return { eventIcon: eventIcon, summarizeEvent: summarizeEvent, getApproval: getApproval, statusFromEvent: statusFromEvent };
}));
