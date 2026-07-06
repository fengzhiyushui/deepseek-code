// src/apps/tui/event-cards.js — kernel 事件 → 已着色卡片行。纯函数;负载全部防御式读取。
// user:message / agent:final / agent:error 静默:用户行与终态行由 app 从 send() 结果路径打印,避免重复。
import { color } from "../../theme.js";

export const QUIET = new Set([
  "model:request", "model:response", "agent:step", "agent:turn_started",
  "user:message", "agent:final", "agent:error",
  "context:cache_loaded", "context:cache_reused", "context:cache_saved",
  "context:snapshot", "context:warm", "context:pin", "context:unpin"
]);

function clip(value, max = 48) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function argsHint(args) {
  if (!args || typeof args !== "object") return "";
  for (const key of ["path", "file", "pattern", "command", "query", "url"]) {
    if (args[key]) return clip(args[key]);
  }
  return "";
}

function fileRows(event) {
  const entries = (Array.isArray(event.files) && event.files.length ? event.files : event.summary) || [];
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    const status = e.status || "M";
    const path = e.path || e.file || "?";
    const counts = [
      Number.isFinite(e.added) ? color.green(`+${e.added}`) : "",
      Number.isFinite(e.removed) ? color.red(`−${e.removed}`) : ""
    ].filter(Boolean).join(" ");
    return ` ${color.dim("│")} ${status} ${path}${counts ? ` ${counts}` : ""}`;
  });
}

export function eventToLines(event = {}, t) {
  const type = event.type || "";
  if (type === "tool:call") {
    const name = event.call?.name || event.tool?.name || event.tool || "?";
    const hint = argsHint(event.call?.args || event.call?.arguments);
    return [` ${color.dim("┌")} tool ▸ ${color.bold(name)}${hint ? ` ${color.dim(hint)}` : ""}`];
  }
  if (type === "tool:result") {
    const status = event.result?.status || event.status || "?";
    const mark = status === "ok" ? color.green(t("ev.toolOk")) : color.red(String(status));
    return [` ${color.dim("└")} ${mark}`];
  }
  if (type === "approval:requested") {
    const summary = clip(event.approval?.summary || event.approval?.id || "", 100);
    return [
      ` ${color.yellow("┌─ " + t("ev.approvalTitle") + " ─")}`,
      ` ${color.yellow("│")} ${summary}`
    ];
  }
  if (type === "approval:resolved") {
    return [` ${color.dim(`· approval ${event.decision || event.approval?.decision || ""}`)}`];
  }
  if (type === "file:diff_preview") {
    return [` ${color.dim(`· diff preview ${clip(event.summary_text || event.diff_hash || "")}`)}`];
  }
  if (type === "file:diff_applied") {
    return [
      ` ${color.dim("┌─")} diff · ${color.cyan(event.change_id || event.record?.id || "?")}`,
      ...fileRows(event),
      ` ${color.dim("└─")}`
    ];
  }
  if (type === "file:rollback_applied") {
    return [` ${color.yellow(`↺ ${t("ev.rollback")} ${event.change_id || event.record?.id || ""}`)}`];
  }
  if (type === "verification:result") {
    return [` ${color.dim(`· ${t("ev.verify")} ${event.result?.status || event.status || "?"}`)}`];
  }
  if (type.startsWith("repair:")) {
    return [` ${color.dim(`· ${t("ev.repair")} ${type.slice("repair:".length)}`)}`];
  }
  if (type === "orchestration:route_resolved") {
    return [` ${color.dim(`· ${t("ev.route")} ▸ ${event.lane || event.route || ""}`)}`];
  }
  if (type.startsWith("orchestration:")) {
    return [` ${color.dim(`· orch ▸ ${type.slice("orchestration:".length)}`)}`];
  }
  if (type === "recovery:report") {
    const found = event.found_count ?? 0;
    const done = event.done_count ?? 0;
    const blocked = event.blocked_count ?? 0;
    return [` ${color.dim(`· ${t("ev.recovery")} found ${found} done ${done} blocked ${blocked}`)}`];
  }
  if (type === "recovery:blocked") {
    return [` ${color.yellow(`· ${t("ev.recovery")} blocked ${event.reason || ""} ${event.item_id || event.source_id || ""}`.trimEnd())}`];
  }
  return [` ${color.dim(`· ${type || "event"}`)}`];
}
