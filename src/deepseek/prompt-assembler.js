export function assembleReplyMessages({ message, classification = null, context = null, systemAddendum = "", history = [] } = {}) {
  const contextSummary = context?.summary ? `\nProject context:\n${context.summary}` : "";
  const taskType = classification?.task_type || "general";
  const system = { role: "system", content: ["You are DeepSeek Code, a local coding agent optimized for DeepSeek models.", "Answer plainly for query tasks. Do not output JSON unless explicitly requested.", `Current task type: ${taskType}.`, contextSummary, systemAddendum].filter(Boolean).join("\n") };
  const priorMessages = sanitizeHistory(history);
  return [system, ...priorMessages, { role: "user", content: String(message || "") }];
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && (entry.role === "user" || entry.role === "assistant") && String(entry.content || "").trim())
    .map((entry) => ({ role: entry.role, content: String(entry.content) }))
    .slice(-20);
}
