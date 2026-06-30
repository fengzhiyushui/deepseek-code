// C4 experience-memory: entry/pending schema + file-level version + helpers.
// id state flow (runtime, not persisted): retrieved (query hit) ⊇ presented (in prompt)
// ⊇ adopted (planner-declared used ∩ presented). Only `adopted` drives reinforce/weaken.

export const FILE_SCHEMA_VERSION = 1;

const KIND = new Set(["procedural", "risk"]);

export function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

function isStr(v) { return typeof v === "string" && v.length > 0; }
function isStrArr(v) { return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0); }

export function validateEntry(e) {
  if (!e || typeof e !== "object") return "entry not an object";
  if (!isStr(e.id)) return "id missing";
  if (!KIND.has(e.kind)) return "bad kind";
  if (!isStr(e.lesson)) return "lesson missing";
  if (!isStrArr(e.cues) || e.cues.length < 1) return "cues must be non-empty string[]";
  if (!e.provenance || typeof e.provenance !== "object") return "provenance missing";
  if (typeof e.confidence !== "number" || e.confidence < 0 || e.confidence > 1) return "confidence out of [0,1]";
  for (const k of ["validations", "misleads"]) {
    if (!Number.isInteger(e[k]) || e[k] < 0) return `${k} must be non-neg int`;
  }
  if (![1, 2, 3].includes(e.tier)) return "tier must be 1|2|3";
  return null;
}

export function validatePending(p) {
  if (!p || typeof p !== "object") return "pending not an object";
  if (!isStr(p.pendingId)) return "pendingId missing";
  return validateEntry(p.entry);
}
