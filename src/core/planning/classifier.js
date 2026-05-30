const EDIT_PATTERN = /\b(fix|change|modify|edit|delete|remove|add|create|write|update|refactor|implement)\b/i;
const DIAGNOSTIC_PATTERN = /\b(debug|diagnose|analyze|investigate|inspect|check)\b/i;
const QUERY_PATTERN = /\b(what|how|why|explain|describe|show|list|who|where|when|can|could|tell|find|get)\b/i;

export function classifyMessage(message, options = {}) {
  const text = String(message || "").trim();
  const autonomy = options.autonomy || "gated";

  if (EDIT_PATTERN.test(text)) {
    return {
      task_type: "edit",
      risk: "medium",
      channel: "think",
      autonomy,
      requires_plan: true,
      reason: "code modification request"
    };
  }

  if (DIAGNOSTIC_PATTERN.test(text)) {
    return {
      task_type: "diagnostic",
      risk: "low",
      channel: "think",
      autonomy,
      requires_plan: false,
      reason: "diagnostic request"
    };
  }

  if (QUERY_PATTERN.test(text) || text.endsWith("?")) {
    return {
      task_type: "query",
      risk: "low",
      channel: "think",
      autonomy,
      requires_plan: false,
      reason: "question or explanation request"
    };
  }

  return {
    task_type: "general",
    risk: "medium",
    channel: "think",
    autonomy,
    requires_plan: true,
    reason: "general agent request"
  };
}
