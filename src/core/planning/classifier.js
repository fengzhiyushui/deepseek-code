import {
  EDIT_PATTERN,
  DIAGNOSTIC_PATTERN,
  QUERY_PATTERN,
  CN_QUESTION_HINT_PATTERN,
  endsWithQuestionMark
} from "./keywords.js";

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

  if (QUERY_PATTERN.test(text) || CN_QUESTION_HINT_PATTERN.test(text) || endsWithQuestionMark(text)) {
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
