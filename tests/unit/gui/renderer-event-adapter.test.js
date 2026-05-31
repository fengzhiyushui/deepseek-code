import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const adapter = require("../../../gui/renderer/event-adapter.js");

test("renderer adapter summarizes V2 events", () => {
  assert.equal(adapter.eventIcon("agent:final"), "F");
  assert.equal(adapter.eventIcon("approval:requested"), "A");
  assert.equal(adapter.summarizeEvent({ type: "tool:call", call: { name: "read" } }), "tool read");
  assert.equal(adapter.summarizeEvent({ type: "verification:result", result: { status: "passed" } }), "verification passed");
  assert.equal(adapter.summarizeEvent({ type: "agent:result", result: { status: "complete" } }), "complete");
});

test("renderer adapter extracts approval ids from V2 approval events", () => {
  const approval = adapter.getApproval({ type: "approval:requested", approval: { id: "apr_1", summary: "edit requires approval" } });

  assert.deepEqual(approval, { id: "apr_1", summary: "edit requires approval" });
  assert.equal(adapter.getApproval({ type: "agent:final" }), null);
});

test("renderer adapter derives status bar state from V2 events", () => {
  assert.deepEqual(
    adapter.statusFromEvent({ type: "model:request", purpose: "act" }),
    { channel: "act" }
  );
  assert.deepEqual(
    adapter.statusFromEvent({ type: "agent:final" }),
    { channel: "idle" }
  );
});

test("renderer adapter summarizes branch rewind and recovery events", () => {
  assert.equal(adapter.eventIcon("session:branch_created"), "B");
  assert.equal(adapter.eventIcon("session:rewind_applied"), "W");
  assert.equal(adapter.eventIcon("session:rewind_recovery_failed"), "!");
  assert.equal(
    adapter.summarizeEvent({ type: "session:branch_activated", branch_id: "br_child" }),
    "branch active br_child"
  );
  assert.equal(
    adapter.summarizeEvent({ type: "session:rewind_preview", rollback_count: 2 }),
    "rewind preview 2 changes"
  );
  assert.equal(
    adapter.summarizeEvent({ type: "session:rewind_restored", restored_files: ["a.txt"] }),
    "rewind restored 1 files"
  );
});

test("renderer adapter maps rewind statuses to status channel", () => {
  assert.deepEqual(adapter.statusFromEvent({ type: "session:rewind_applied" }), { channel: "rewind" });
  assert.deepEqual(adapter.statusFromEvent({ type: "session:rewind_recovery_failed" }), { channel: "recovery" });
});
