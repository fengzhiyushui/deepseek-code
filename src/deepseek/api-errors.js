export function formatDeepSeekApiError(status, text = "") {
  const parsed = parseErrorBody(text);
  const message = parsed?.error?.message || parsed?.message || truncate(String(text || ""));
  return `DeepSeek API ${status}: ${message || "request failed"}`;
}
export function createDeepSeekApiError(status, text = "") {
  const error = new Error(formatDeepSeekApiError(status, text));
  error.name = "DeepSeekApiError";
  error.code = "DEEPSEEK_API_ERROR";
  error.status = status;
  error.retryable = isRetryableDeepSeekError({ status });
  return error;
}
export function isRetryableDeepSeekError(errorLike = {}) {
  if (errorLike.finish_reason === "insufficient_system_resource") return true;
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(errorLike.status);
}
function parseErrorBody(text) { try { return JSON.parse(text); } catch { return null; } }
function truncate(text) { return text.length > 220 ? `${text.slice(0, 220)}...` : text; }
