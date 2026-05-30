import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeKernelEvent,
  renderKernelResult,
  createEventRenderer
} from "../../../../src/apps/cli/render-events.js";

test("summarizeKernelEvent formats key V2 events without raw payload dumps", () => {
  assert.equal(
    summarizeKernelEvent({ type: "tool:call", call: { name: "read" } }),
    "tool read"
  );
  assert.equal(
    summarizeKernelEvent({ type: "file:diff_applied", change_id: "chg_1" }),
    "diff applied chg_1"
  );
  assert.equal(
    summarizeKernelEvent({ type: "approval:requested", approval: { id: "apr_1", summary: "edit requires approval" } }),
    "approval apr_1 edit requires approval"
  );
  assert.equal(
    summarizeKernelEvent({ type: "agent:final", content: "hello" }),
    "final hello"
  );
});

test("renderKernelResult returns final content and approval message", () => {
  assert.deepEqual(
    renderKernelResult({ status: "complete", content: "done" }),
    ["", "done"]
  );
  assert.deepEqual(
    renderKernelResult({ status: "awaiting_approval", approval: { id: "apr_1" } }),
    ["", "Approval required: apr_1", "V2-5 CLI only displays approval requests. Approval resume is a later phase."]
  );
});

test("createEventRenderer writes only useful progress events", () => {
  const lines = [];
  const renderer = createEventRenderer({ write: (line) => lines.push(line) });

  renderer({ type: "user:message", content: "hi" });
  renderer({ type: "tool:result", result: { status: "success" } });
  renderer({ type: "model:request", purpose: "act" });

  assert.deepEqual(lines, ["- user hi", "- tool result success"]);
});
