import { classifyMessage } from "../planning/classifier.js";

// Strong complexity markers score +2; everything else configured scores +1 (weak).
export const STRONG_MARKERS = ["重构整个", "迁移", "跨多个文件", "跨文件", "refactor the entire", "migrate", "across multiple"];
export const DEFAULT_WEAK_MARKERS = ["这几个", "这些", "分别", "各自", "逐个", "逐一", "for each", "each of"];
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
    + Math.min(feat.files.length, 3)
    + (feat.longEdit ? 1 : 0);
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
    fileScore: Math.min(feat.files.length, 3),
    longEdit: feat.longEdit
  };
}
