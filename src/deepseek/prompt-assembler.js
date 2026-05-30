export function assembleReplyMessages({ message, classification = null, context = null, systemAddendum = "" } = {}) {
  const contextSummary = context?.summary ? `\nProject context:\n${context.summary}` : "";
  const taskType = classification?.task_type || "general";
  return [{ role: "system", content: ["You are DeepSeek Code, a local coding agent optimized for DeepSeek models.", "Answer plainly for query tasks. Do not output JSON unless explicitly requested.", `Current task type: ${taskType}.`, contextSummary, systemAddendum].filter(Boolean).join("\n") }, { role: "user", content: String(message || "") }];
}
