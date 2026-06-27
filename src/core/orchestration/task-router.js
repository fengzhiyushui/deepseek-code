import { classifyMessage } from "../planning/classifier.js";

const DEFAULT_MARKERS = [
  "这几个", "这些", "分别", "各自", "逐个", "逐一", "重构整个", "迁移", "跨多个文件", "跨文件",
  "for each", "each of", "across multiple", "refactor the entire", "migrate"
];
const FILE_TOKEN = /\b[\w.-]+\.(?:js|mjs|cjs|jsx|ts|tsx|py|json|md)\b/gi;

export function createTaskRouter({ minComplexFiles = 2, markers = DEFAULT_MARKERS } = {}) {
  function route(message, options = {}) {
    const classification = classifyMessage(message, options);
    const text = String(message || "");
    const signals = [];
    for (const m of markers) if (text.toLowerCase().includes(m.toLowerCase())) signals.push(`marker:${m}`);
    const files = new Set((text.match(FILE_TOKEN) || []).map((f) => f.toLowerCase()));
    if (files.size >= minComplexFiles) signals.push(`files:${files.size}`);
    const lane = signals.length > 0 ? "orchestrate" : "single";
    return {
      lane,
      reason: lane === "orchestrate" ? "complexity signals present" : "no complexity signals",
      signals,
      classification
    };
  }
  return { route };
}
