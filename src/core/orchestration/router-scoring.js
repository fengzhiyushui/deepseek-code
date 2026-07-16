import { classifyMessage } from "../planning/classifier.js";
import {
  COMPLEXITY_STRONG_MARKERS,
  COMPLEXITY_WEAK_MARKERS
} from "../planning/keywords.js";

// 兼容既有导出名;实际词表唯一来源是 planning/keywords.js。
export const STRONG_MARKERS = COMPLEXITY_STRONG_MARKERS;
export const DEFAULT_WEAK_MARKERS = COMPLEXITY_WEAK_MARKERS;
export const LONG_EDIT_CHARS = 80;

const FILE_EXT = "js|mjs|cjs|jsx|ts|tsx|py|json|md";
const FILE_TOKEN = new RegExp(
  `[\\w.\\\\/-]*\\.(?:${FILE_EXT})\\b` +   // path?/name.ext  (src/foo.ts, src\foo.ts, foo.ts)
  `|\\*\\.(?:${FILE_EXT})` +               // *.ts
  `|[\\w.\\\\/-]+\\/\\*\\*?`,              // dir/* or dir/**
  "gi"
);

export function normalizeFileToken(tok) {
  return String(tok || "")
    .replace(/\\/g, "/")        // win32 sep → posix
    .replace(/^\.\//, "")       // strip leading ./
    .replace(/\/{2,}/g, "/")    // collapse repeated /
    .toLowerCase();
}

export function extractFeatures(message, options = {}, { markers = DEFAULT_WEAK_MARKERS } = {}) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const strong = STRONG_MARKERS.filter((m) => lower.includes(m.toLowerCase()));
  const weak = markers.filter((m) => !STRONG_MARKERS.includes(m)).filter((m) => lower.includes(m.toLowerCase()));
  const files = [...new Set((text.match(FILE_TOKEN) || []).map(normalizeFileToken))];
  const classification = classifyMessage(text, options);
  const longEdit = classification.task_type === "edit" && text.trim().length >= LONG_EDIT_CHARS;
  return { strong, weak, files, longEdit, classification };
}

export function computeScore(feat) {
  return feat.strong.length * 2
    + feat.weak.length
    + fileScore(feat.files)
    + (feat.longEdit ? 1 : 0);
}

// First file mention is free (a single-file request is not a complexity signal,
// matching the legacy minComplexFiles=2 gate); each additional file +1, capped at 3.
function fileScore(files) {
  return Math.min(Math.max(files.length - 1, 0), 3);
}

export function classifyBand(score, complexThreshold) {
  if (score <= 0) return "simple";
  if (score >= complexThreshold) return "complex";
  return "ambiguous";
}

// Event-safe projection: short tokens + counts only, never the raw message; lists capped.
export function featuresForEvent(feat) {
  return {
    strongMarkers: feat.strong.slice(0, 8),
    weak: feat.weak.length,
    files: feat.files.slice(0, 8),
    fileScore: fileScore(feat.files),
    longEdit: feat.longEdit
  };
}
