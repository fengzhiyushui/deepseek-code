export function promptMentionsJson(messages = []) {
  return messages.some((message) => {
    if (message.role !== "system" && message.role !== "user") return false;
    const content = typeof message.content === "string" ? message.content : "";
    return /\bjson\b/i.test(content);
  });
}

export function applyJsonMode({ body, messages, jsonMode = false }) {
  const next = { ...body };
  if (!jsonMode) { delete next.response_format; return next; }
  if (!promptMentionsJson(messages)) throw new Error("JSON mode requires a system or user prompt containing the word json");
  next.response_format = { type: "json_object" };
  return next;
}

export function parseJsonContent(content) {
  try { return JSON.parse(content); }
  catch (error) {
    const err = new Error(`invalid DeepSeek JSON content: ${error.message}`);
    err.code = "DEEPSEEK_INVALID_JSON";
    err.cause = error;
    throw err;
  }
}
