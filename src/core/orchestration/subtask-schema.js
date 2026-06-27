const TOOL_PROFILE_VALUES = new Set(["edit", "readonly"]);
const SEVERITY_VALUES = new Set(["block", "warn"]);

function isStr(v) { return typeof v === "string" && v.length > 0; }
function isStrArray(v) { return Array.isArray(v) && v.every((x) => typeof x === "string"); }

export function validateSubTask(st) {
  if (!st || typeof st !== "object") return "subtask not an object";
  if (!isStr(st.id)) return "subtask.id missing";
  if (!isStr(st.goal)) return `subtask ${st.id}: goal missing`;
  if (!isStrArray(st.acceptance)) return `subtask ${st.id}: acceptance not string[]`;
  if (!st.context_scope || typeof st.context_scope !== "object") return `subtask ${st.id}: context_scope missing`;
  if (!TOOL_PROFILE_VALUES.has(st.tool_profile)) return `subtask ${st.id}: bad tool_profile`;
  if (!isStrArray(st.depends_on)) return `subtask ${st.id}: depends_on not string[]`;
  return null;
}

export function validatePlan(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "plan not an object" };
  if (!isStr(obj.task_summary)) return { ok: false, error: "task_summary missing" };
  if (!isStr(obj.done_when)) return { ok: false, error: "done_when missing" };
  if (!Array.isArray(obj.subtasks) || obj.subtasks.length === 0) return { ok: false, error: "subtasks empty" };
  const ids = new Set();
  for (const st of obj.subtasks) {
    const err = validateSubTask(st);
    if (err) return { ok: false, error: err };
    if (ids.has(st.id)) return { ok: false, error: `duplicate subtask id ${st.id}` };
    ids.add(st.id);
  }
  for (const st of obj.subtasks) {
    for (const dep of st.depends_on) if (!ids.has(dep)) return { ok: false, error: `${st.id} depends on unknown ${dep}` };
  }
  return { ok: true, plan: obj };
}

export function validateVerdict(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, error: "verdict not an object" };
  if (typeof obj.pass !== "boolean") return { ok: false, error: "verdict.pass not boolean" };
  if (!SEVERITY_VALUES.has(obj.severity)) return { ok: false, error: "verdict.severity invalid" };
  if (!isStrArray(obj.reasons)) return { ok: false, error: "verdict.reasons not string[]" };
  if (!isStrArray(obj.checked)) return { ok: false, error: "verdict.checked not string[]" };
  return { ok: true, verdict: obj };
}

export function hasCycle(subtasks) {
  try { topoOrder(subtasks); return false; } catch (e) { if (e.code === "CYCLE") return true; throw e; }
}

export function topoOrder(subtasks) {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const state = new Map(); // id -> 0 unseen | 1 visiting | 2 done
  const out = [];
  function visit(id) {
    const st = byId.get(id);
    if (!st) return;
    const s = state.get(id) || 0;
    if (s === 2) return;
    if (s === 1) { const err = new Error(`dependency cycle at ${id}`); err.code = "CYCLE"; throw err; }
    state.set(id, 1);
    for (const dep of st.depends_on) visit(dep);
    state.set(id, 2);
    out.push(st);
  }
  for (const st of subtasks) visit(st.id);
  return out;
}

// C5: stable identity for "no-progress" detection — independent of subtask id,
// so a model that renames an id but redoes the same thing is caught.
export function fingerprint(st) {
  const files = Array.isArray(st.context_scope?.files)
    ? [...st.context_scope.files].map((f) => String(f).replace(/\\/g, "/").toLowerCase()).sort()
    : [];
  return [String(st.goal || "").trim().toLowerCase(), files.join(","), st.tool_profile || ""].join("|");
}

// C5: a replan round's new subtasks. Stricter than validatePlan: ids must be
// globally unique across rounds; deps may only point to completed or same-round
// tasks; a dep on a failed task is allowed only via corrective_for pointing at it.
export function validateReplan(subtasks, { seenSubtaskIds = new Set(), completedIds = new Set(), failedIds = new Set() } = {}) {
  if (!Array.isArray(subtasks)) return { ok: false, error: "subtasks not an array" };
  const thisRound = new Set();
  for (const st of subtasks) {
    const base = validateSubTask(st);
    if (base) return { ok: false, error: base };
    if (seenSubtaskIds.has(st.id) || thisRound.has(st.id)) return { ok: false, error: `duplicate subtask id across rounds: ${st.id}` };
    thisRound.add(st.id);
  }
  for (const st of subtasks) {
    if (st.corrective_for !== undefined && !failedIds.has(st.corrective_for)) {
      return { ok: false, error: `${st.id}: corrective_for must reference a failed task` };
    }
    for (const dep of st.depends_on) {
      const known = completedIds.has(dep) || thisRound.has(dep) || failedIds.has(dep);
      if (!known) return { ok: false, error: `${st.id} depends on unknown ${dep}` };
      if (failedIds.has(dep) && st.corrective_for !== dep) {
        return { ok: false, error: `${st.id} depends on failed ${dep} without corrective_for` };
      }
    }
  }
  return { ok: true };
}
