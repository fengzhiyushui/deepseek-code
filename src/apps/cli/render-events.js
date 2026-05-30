const QUIET_EVENTS = new Set(["model:request", "model:response", "agent:step", "agent:turn_started"]);

export function summarizeKernelEvent(event = {}) {
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
  return event.type || "event";
}

export function renderKernelResult(result = {}) {
  if (result.status === "awaiting_approval") {
    return [
      "",
      `Approval required: ${result.approval?.id || "unknown"}`,
      "V2-5 CLI only displays approval requests. Approval resume is a later phase."
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
    write(`- ${summarizeKernelEvent(event)}`);
  };
}

function clip(value, max = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
