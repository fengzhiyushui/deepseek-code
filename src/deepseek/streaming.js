export function parseSseBuffer(buffer) {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() || "";
  const events = [];
  let done = false;
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") { done = true; continue; }
    events.push(JSON.parse(data));
  }
  return { events, done, remainder };
}

export async function readDeepSeekStream(body, { onDelta = null, signal = null } = {}) {
  if (!body || typeof body.getReader !== "function") throw new Error("DeepSeek stream response body is not readable");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", reasoningContent = "", usage = null, finishReason = null;
  const toolCalls = [];
  while (true) {
    if (signal?.aborted) { await reader.cancel().catch(() => {}); throw abortError(); }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.remainder;
    for (const event of parsed.events) {
      if (event.usage) usage = event.usage;
      const choice = event.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};
      if (delta.content) { content += delta.content; if (onDelta) onDelta(delta.content); }
      if (delta.reasoning_content) reasoningContent += delta.reasoning_content;
      if (Array.isArray(delta.tool_calls)) mergeToolCallDeltas(toolCalls, delta.tool_calls);
    }
    if (parsed.done) break;
  }
  return { content, reasoning_content: reasoningContent || null, usage, finish_reason: finishReason, tool_calls: toolCalls };
}

function mergeToolCallDeltas(target, deltas) {
  for (const delta of deltas) {
    const index = delta.index ?? target.length;
    if (!target[index]) target[index] = { id: delta.id || null, type: delta.type || "function", function: { name: "", arguments: "" } };
    const call = target[index];
    if (delta.id) call.id = delta.id;
    if (delta.type) call.type = delta.type;
    if (delta.function?.name) call.function.name += delta.function.name;
    if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
  }
}
function abortError() { const error = new Error("DeepSeek stream was aborted"); error.name = "AbortError"; error.code = "ABORT_ERR"; return error; }
