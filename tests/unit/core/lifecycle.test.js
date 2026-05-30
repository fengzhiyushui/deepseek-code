import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessage } from "../../../src/core/planning/classifier.js";
import {
  createLifecycleState,
  transitionLifecycle,
  RUNTIME_STATES
} from "../../../src/core/runtime/lifecycle.js";

test("classifyMessage separates query, edit, diagnostic, and general tasks", () => {
  assert.equal(classifyMessage("what does this project do?").task_type, "query");
  assert.equal(classifyMessage("fix the login bug").task_type, "edit");
  assert.equal(classifyMessage("debug the failing test").task_type, "diagnostic");
  assert.equal(classifyMessage("continue").task_type, "general");
});

test("classifyMessage carries autonomy and route metadata", () => {
  const result = classifyMessage("fix the bug", { autonomy: "supervised" });

  assert.equal(result.autonomy, "supervised");
  assert.equal(result.risk, "medium");
  assert.equal(result.channel, "think");
  assert.equal(result.requires_plan, true);
});

test("lifecycle starts idle and transitions immutably", () => {
  const initial = createLifecycleState();
  const next = transitionLifecycle(initial, {
    to: "classify",
    reason: "user message received",
    channel: "think"
  });

  assert.deepEqual(RUNTIME_STATES.includes("idle"), true);
  assert.equal(initial.current, "idle");
  assert.equal(next.current, "classify");
  assert.equal(next.previous, "idle");
  assert.equal(next.channel, "think");
  assert.equal(next.reason, "user message received");
  assert.ok(next.trace_id.startsWith("trace_"));
});

test("transitionLifecycle rejects invalid states", () => {
  const initial = createLifecycleState();
  assert.throws(
    () => transitionLifecycle(initial, { to: "missing", reason: "bad" }),
    /invalid runtime state/
  );
});
