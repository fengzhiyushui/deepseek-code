// Fold the activity event stream into the bottom-panel Problems/Output view-models. Pure.
export function derivePanels(activity, errors) {
  const problems = [];
  const output = [];
  for (const e of activity || []) {
    if (e && e.type === "verification:result" && e.pass === false) {
      problems.push({ kind: "verify", message: e.message || "verification failed" });
    }
    if (e && e.type === "agent:error") {
      problems.push({ kind: "error", message: e.message || e.error || "agent error" });
    }
    if (e && e.type) output.push({ type: e.type, text: formatEvent(e) });
  }
  for (const er of errors || []) {
    problems.push({ kind: er.area || "runtime", message: er.message });
  }
  return { problems, output };
}

function formatEvent(e) {
  if (e.type === "tool:call") return `→ ${e.tool || e.name || "tool"}`;
  if (e.type === "tool:result") return `  ${e.status || "done"}`;
  if (e.type === "file:diff_applied") return `edit ${e.path || ""} (+${e.added || 0} -${e.removed || 0})`;
  if (e.type === "verification:result") return e.pass ? "verify ✓" : "verify ✗";
  if (e.type === "agent:final") return `done: ${e.status || "ok"}`;
  return e.type;
}
