import test from "node:test";
import assert from "node:assert/strict";
import { parseSseBuffer, readDeepSeekStream } from "../../../src/deepseek/streaming.js";

test("parseSseBuffer parses complete data lines and preserves remainder", () => {
  const parsed = parseSseBuffer("data: {\"a\":1}\n\ndata: {\"b\"");
  assert.deepEqual(parsed.events, [{ a: 1 }]);
  assert.equal(parsed.done, false);
  assert.equal(parsed.remainder, "data: {\"b\"");
});

test("parseSseBuffer detects DONE marker", () => {
  const parsed = parseSseBuffer("data: {\"a\":1}\n\ndata: [DONE]\n\n");
  assert.equal(parsed.done, true);
  assert.deepEqual(parsed.events, [{ a: 1 }]);
});

test("readDeepSeekStream accumulates content reasoning usage and tool call deltas", async () => {
  const chunks = [
    "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"hel\"},\"finish_reason\":null,\"index\":0}],\"usage\":null}\n\n",
    "data: {\"choices\":[{\"delta\":{\"content\":\"lo\",\"reasoning_content\":\"hidden\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\"}}]},\"finish_reason\":null,\"index\":0}],\"usage\":null}\n\n",
    "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"README.md\\\"}\"}}]},\"finish_reason\":\"tool_calls\",\"index\":0}],\"usage\":null}\n\n",
    "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5,\"prompt_cache_hit_tokens\":7,\"prompt_cache_miss_tokens\":3}}\n\n",
    "data: [DONE]\n\n"
  ];
  const deltas = [];
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
  const result = await readDeepSeekStream(stream, { onDelta: (text) => deltas.push(text) });
  assert.equal(result.content, "hello");
  assert.equal(result.reasoning_content, "hidden");
  assert.equal(result.finish_reason, "tool_calls");
  assert.deepEqual(deltas, ["hel", "lo"]);
  assert.equal(result.usage.prompt_cache_hit_tokens, 7);
  assert.equal(result.tool_calls[0].id, "call_1");
  assert.equal(result.tool_calls[0].function.name, "read");
  assert.equal(result.tool_calls[0].function.arguments, "{\"path\":\"README.md\"}");
});
