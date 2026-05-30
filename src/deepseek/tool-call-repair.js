export function parseToolArguments(raw) {
  if (raw === "" || raw === undefined || raw === null) return { ok: true, value: {} };
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch (error) { return { ok: false, value: null, error: error.message }; }
}

export function normalizeToolCalls(toolCalls = []) {
  return toolCalls.map((call, index) => {
    const rawArguments = call.function?.arguments || "";
    const parsed = parseToolArguments(rawArguments);
    return { id: call.id || `tool_call_${index}`, type: call.type || "function", name: call.function?.name || "", arguments: parsed.ok ? parsed.value : null, raw_arguments: rawArguments, arguments_parse_error: parsed.ok ? null : parsed.error };
  });
}
