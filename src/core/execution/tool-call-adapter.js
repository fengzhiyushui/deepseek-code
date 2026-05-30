import { createToolCall } from "../protocol/index.js";

export function adaptDeepSeekToolCall(rawCall, { requestedByStepId } = {}) {
  if (!requestedByStepId) throw new Error("requestedByStepId is required");
  if (!rawCall?.name) throw new Error("tool call name is required");
  if (rawCall.arguments_parse_error) {
    throw new Error(`invalid tool arguments for ${rawCall.name}: ${rawCall.arguments_parse_error}`);
  }
  if (rawCall.arguments === null || Array.isArray(rawCall.arguments) || typeof rawCall.arguments !== "object") {
    throw new Error(`invalid tool arguments for ${rawCall.name}`);
  }
  return createToolCall({
    id: rawCall.id,
    name: rawCall.name,
    params: rawCall.arguments || {},
    source: "model",
    requestedByStepId
  });
}

export function adaptDeepSeekToolCalls(rawCalls = [], options = {}) {
  return rawCalls.map((call) => adaptDeepSeekToolCall(call, options));
}
