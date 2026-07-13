import { describeEvent } from "../event-contract.js";

const QUIET_EVENTS = new Set(["model:request", "model:response", "agent:step", "agent:turn_started"]);

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function orchestrationSummary(d) {
  const f = d.fields;
  switch (d.kind) {
    case "orchestration-route": return "routing: multi-agent";
    case "orchestration-plan": return `plan: ${plural(f.subtasks ?? 0, "subtask")}`;
    case "orchestration-round-start": return `round ${f.round ?? 0}: ${plural(f.subtasks ?? 0, "subtask")}`;
    case "orchestration-replan": return `replan round ${f.round ?? 0}: ${plural(f.newSubtasks ?? 0, "new subtask")}`;
    case "orchestration-complete": return `orchestration complete: ${f.completed ?? 0} succeeded, ${f.failed ?? 0} failed (status: ${f.status ?? "unknown"})`;
    case "orchestration-subtask-start": {
      const attempt = `attempt ${f.attempt ?? 1}`;
      const parts = f.toolProfile ? `${attempt}, profile ${f.toolProfile}` : attempt;
      return `subtask ${f.subtaskId ?? "?"}: starting (${parts})`;
    }
    case "orchestration-subtask-review": {
      const verdict = f.pass ? "passed" : "failed";
      const sev = (!f.pass && f.reviewSeverity) ? ` (severity: ${f.reviewSeverity})` : "";
      return `subtask ${f.subtaskId ?? "?"}: review ${verdict}${sev}`;
    }
    default: return null;
  }
}

export function summarizeKernelEvent(event = {}) {
  const d = describeEvent(event);
  const orch = orchestrationSummary(d);
  if (orch) return orch;
  if (d.kind === "experience-retrieved") return `experience: ${d.fields.count ?? 0} recalled`;

  if (event.type === "user:message") return `user ${clip(event.content || "")}`;
  if (event.type === "tool:call") return `tool ${event.call?.name || event.tool?.name || event.tool || "unknown"}`;
  if (event.type === "tool:result") return `tool result ${event.result?.status || event.status || "unknown"}`;
  if (event.type === "permission:decision") return `permission ${event.permission?.decision || event.decision || "unknown"}`;
  if (event.type === "approval:requested") return `approval ${event.approval?.id || "unknown"} ${clip(event.approval?.summary || "")}`.trim();
  if (event.type === "file:diff_preview") return `diff preview ${event.summary || event.diff_hash || ""}`.trim();
  if (event.type === "file:diff_applied") return `diff applied ${event.change_id || event.record?.id || ""}`.trim();
  if (event.type === "file:rollback_applied") return `rollback ${event.change_id || event.record?.id || ""}`.trim();
  if (event.type === "verification:result") return `verification ${event.result?.status || event.status || "unknown"}`;
  if (event.type === "agent:final") return `final ${clip(event.content || "")}`.trim();
  if (event.type === "agent:error") return `error ${clip(event.message || event.error || "")}`.trim();
  if (event.type === "session:branch_created") return `branch created ${event.branch_id || "unknown"}`;
  if (event.type === "session:branch_activated") return `branch active ${event.branch_id || "unknown"}`;
  if (event.type === "session:rewind_preview") return `rewind preview ${event.rollback_count || event.rollback_change_ids?.length || 0} changes`;
  if (event.type === "session:rewind_applied") return `rewind applied ${event.branch_id || "unknown"} ${(event.rollback_change_ids || []).length} changes`;
  if (event.type === "session:rewind_conflict") return `rewind conflict ${event.failed_change_id || "unknown"}`;
  if (event.type === "session:rewind_failed") return `rewind failed ${event.failed_change_id || event.reason || "unknown"}`;
  if (event.type === "session:rewind_restore_started") return `rewind restoring ${(event.applied_rollbacks || []).length} changes`;
  if (event.type === "session:rewind_restored") return `rewind restored ${(event.restored_files || []).length} files`;
  if (event.type === "session:rewind_recovery_failed") return `rewind recovery failed ${event.reason || event.restore_error || "unknown"}`;
  if (event.type === "recovery:report") return `recovery report: found ${event.found_count || 0}, done ${event.done_count || 0}, blocked ${event.blocked_count || 0}`;
  if (event.type === "recovery:blocked") return `recovery blocked: ${event.reason || "unknown"} (${event.item_id || event.source_id || "unknown"})`;
  if (event.type === "tx:recovered") return `recovered ${event.kind || "transaction"} ${event.tx_id || "unknown"}, preserved ${event.preserved_count || 0}`;
  if (event.type === "turn:rehydrated") return `rehydrated approval ${event.approval_id || "unknown"}`;
  if (event.type === "turn:cancelled") return `cancelled approval ${event.approval_id || "unknown"}`;
  if (event.type === "takeover:requested") return `takeover requested ${event.request_id || "unknown"}`;
  if (event.type === "takeover:completed") return `takeover completed ${event.request_id || "unknown"}`;
  return event.type || "event";
}

export function renderKernelResult(result = {}) {
  if (result.status === "awaiting_approval") {
    return [
      "",
      `Approval required: ${result.approval?.id || "unknown"}`,
      "Approve? y/N"
    ];
  }
  if (result.status === "error") {
    return ["", `Error: ${result.error || result.message || "unknown error"}`];
  }
  return ["", result.content || ""];
}

export function createEventRenderer({ write = console.log } = {}) {
  return function renderEvent(event) {
    if (!event?.type || QUIET_EVENTS.has(event.type)) return;
    const line = summarizeKernelEvent(event);
    // experience:retrieved 在 count===0 时不打印(契约 quiet);其余照原行为。
    const d = describeEvent(event);
    if (d.kind === "experience-retrieved" && d.quiet) return;
    write(`- ${line}`);
  };
}

function clip(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
