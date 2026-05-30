import test from "node:test";
import assert from "node:assert/strict";
import {
  toolResultToMessage,
  toolResultsToMessages,
  summarizeToolResult
} from "../../../../src/core/execution/tool-result-router.js";

test("toolResultToMessage creates DeepSeek-compatible tool feedback", () => {
  const message = toolResultToMessage({
    call_id: "call_1",
    status: "success",
    content: [{ type: "text", text: "hello" }],
    metadata: { path: "README.md" }
  });

  assert.equal(message.role, "tool");
  assert.equal(message.tool_call_id, "call_1");
  assert.match(message.content, /"status":"success"/);
  assert.match(message.content, /hello/);
});

test("summarizeToolResult truncates long content and keeps metadata compact", () => {
  const summary = summarizeToolResult({
    call_id: "call_1",
    status: "success",
    content: [{ type: "text", text: "x".repeat(4000) }],
    metadata: { change_id: "c1", large: "y".repeat(4000) }
  }, { maxContentChars: 100, maxMetadataChars: 80 });

  assert.equal(summary.text.length, 100);
  assert.equal(summary.truncated, true);
  assert.equal(summary.metadata.large, undefined);
  assert.equal(summary.metadata.change_id, "c1");
});

test("toolResultsToMessages maps all results", () => {
  const messages = toolResultsToMessages([
    { call_id: "a", status: "success", content: [{ type: "text", text: "A" }] },
    { call_id: "b", status: "error", content: [{ type: "error", text: "B" }] }
  ]);

  assert.deepEqual(messages.map((message) => message.tool_call_id), ["a", "b"]);
});
