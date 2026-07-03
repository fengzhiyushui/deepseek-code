// gui/src/state/changes-derive.js — fold change-bridge entries into the SCM
// "Agent Changes" view-models. Pure — node:test-covered.

const MANUAL_PREFIX = "GUI edit ";

export function deriveChangeEntries(list) {
  return (list || []).filter((c) => c && c.id).map((c) => {
    const prompt = String(c.prompt || "");
    return {
      id: c.id,
      time: c.time || "",
      timeShort: shortTime(c.time),
      prompt,
      promptShort: truncate(prompt, 42),
      source: prompt.startsWith(MANUAL_PREFIX) ? "manual" : "agent",
      rolledBack: Boolean(c.rolledBack),
      files: (c.files || []).map((f) => ({
        path: f.path || "",
        status: f.status || "modify",
        added: Number.isInteger(f.added) ? f.added : null,
        removed: Number.isInteger(f.removed) ? f.removed : null,
        hunkStarts: Array.isArray(f.hunkStarts) ? f.hunkStarts : null
      }))
    };
  });
}

export function statusLetter(status) {
  if (status === "create") return "A";
  if (status === "delete") return "D";
  return "M";
}

export function clampLine(line, maxLine) {
  const l = Math.max(1, Math.floor(Number(line) || 1));
  const m = Math.max(1, Math.floor(Number(maxLine) || 1));
  return Math.min(l, m);
}

export function shortTime(iso) {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function truncate(s, n) {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
