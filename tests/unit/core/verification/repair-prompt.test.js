import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairMessages, summarizeRepairToolResults } from "../../../../src/core/verification/repair-prompt.js";

test("buildRepairMessages includes failure reason and excludes reasoning content", () => {
  const messages = buildRepairMessages({
    userMessage: "fix failing test",
    classification: { task_type: "edit" },
    verification: {
      status: "failed",
      reason: "Expected 1, got 2",
      reasoning_content: "hidden chain of thought"
    },
    toolResults: [
      {
        call_id: "call_edit",
        status: "success",
        content: [{ type: "text", text: "applied diff" }],
        metadata: { change_id: "chg_1", diff_hash: "abc", secret: "sk-test" }
      }
    ],
    previousRepairAttempts: [],
    maxRepairAttempts: 2
  });

  const text = JSON.stringify(messages);
  assert.match(text, /Expected 1, got 2/);
  assert.match(text, /fix failing test/);
  assert.doesNotMatch(text, /hidden chain of thought/);
  assert.doesNotMatch(text, /sk-test/);
});

test("summarizeRepairToolResults truncates long tool output", () => {
  const long = "x".repeat(5000);
  const summary = summarizeRepairToolResults([
    { call_id: "call_1", status: "success", content: [{ type: "text", text: long }], metadata: { path: "a.txt" } }
  ], { maxTextChars: 120 });

  assert.equal(summary.length, 1);
  assert.equal(summary[0].text.length, 120);
  assert.equal(summary[0].truncated, true);
  assert.deepEqual(summary[0].metadata, { path: "a.txt" });
});

test("repair prompt includes bounded context summary", () => {
  const messages = buildRepairMessages({
    userMessage: "fix a bug",
    classification: { task_type: "edit" },
    verification: { status: "failed", reason: "tests failed" },
    toolResults: [],
    context: { summary: "Project files:\n- src/index.js (P1 mentioned)\n--- src/index.js\nexport const x = 1;" }
  });

  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.context_summary.includes("src/index.js"), true);
});
