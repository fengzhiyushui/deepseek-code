import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptDeepSeekToolCall,
  adaptDeepSeekToolCalls
} from "../../../../src/core/execution/tool-call-adapter.js";

test("adaptDeepSeekToolCall converts normalized DeepSeek call to V2 ToolCall", () => {
  const call = adaptDeepSeekToolCall({
    id: "call_read",
    name: "read",
    arguments: { path: "README.md" }
  }, { requestedByStepId: "step_1" });

  assert.equal(call.id, "call_read");
  assert.equal(call.name, "read");
  assert.deepEqual(call.params, { path: "README.md" });
  assert.equal(call.source, "model");
  assert.equal(call.requested_by_step_id, "step_1");
});

test("adaptDeepSeekToolCall rejects missing name and malformed arguments", () => {
  assert.throws(
    () => adaptDeepSeekToolCall({ id: "c1", arguments: {} }, { requestedByStepId: "s1" }),
    /tool call name is required/
  );
  assert.throws(
    () => adaptDeepSeekToolCall({ id: "c2", name: "read", arguments: null, arguments_parse_error: "bad json" }, { requestedByStepId: "s1" }),
    /invalid tool arguments/
  );
});

test("adaptDeepSeekToolCalls maps a list and preserves order", () => {
  const calls = adaptDeepSeekToolCalls([
    { id: "c1", name: "read", arguments: { path: "a.txt" } },
    { id: "c2", name: "grep", arguments: { pattern: "x" } }
  ], { requestedByStepId: "step_1" });

  assert.deepEqual(calls.map((call) => call.name), ["read", "grep"]);
});
