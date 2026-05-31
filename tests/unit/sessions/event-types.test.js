import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_EVENT_TYPES,
  isSessionEventType,
  assertSessionEventType
} from "../../../src/sessions/event-types.js";

test("session event registry contains the v2 canonical events", () => {
  for (const type of [
    "session:start",
    "session:resume",
    "session:branch_created",
    "session:branch_activated",
    "session:rewind_preview",
    "session:rewind_started",
    "session:rewind_applied",
    "session:rewind_conflict",
    "session:rewind_failed",
    "user:message",
    "agent:turn_started",
    "agent:step",
    "model:request",
    "model:response",
    "tool:call",
    "tool:result",
    "permission:decision",
    "approval:requested",
    "approval:resolved",
    "context:snapshot",
    "context:pin",
    "context:unpin",
    "context:warm",
    "context:cache_loaded",
    "context:cache_saved",
    "context:cache_reused",
    "file:diff_preview",
    "file:diff_applied",
    "file:rollback_applied",
    "file:transaction_started",
    "file:transaction_committed",
    "file:transaction_failed",
    "file:transaction_rolled_back",
    "file:rollback_conflict",
    "verification:result",
    "repair:started",
    "repair:attempt",
    "repair:result",
    "repair:exhausted",
    "agent:final",
    "agent:error"
  ]) {
    assert.ok(SESSION_EVENT_TYPES.includes(type), `${type} missing`);
    assert.equal(isSessionEventType(type), true);
  }
});

test("session event registry contains repair events", () => {
  for (const type of ["repair:started", "repair:attempt", "repair:result", "repair:exhausted"]) {
    assert.ok(SESSION_EVENT_TYPES.includes(type), `${type} should be registered`);
  }
});

test("assertSessionEventType rejects unknown events", () => {
  assert.doesNotThrow(() => assertSessionEventType("agent:step"));
  assert.throws(
    () => assertSessionEventType("unknown:event"),
    /unknown session event type/
  );
});
