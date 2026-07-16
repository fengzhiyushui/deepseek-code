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

test("classifyMessage supports Chinese edit, diagnostic, query, and full-width question mark", () => {
  assert.equal(classifyMessage("修复这个登录 bug").task_type, "edit");
  assert.equal(classifyMessage("重构认证模块并补测试").task_type, "edit");
  assert.equal(classifyMessage("排查为什么测试失败").task_type, "diagnostic");
  assert.equal(classifyMessage("解释这个项目的架构").task_type, "query");
  assert.equal(classifyMessage("这个函数做什么？").task_type, "query");
  assert.equal(classifyMessage("可以继续吗").task_type, "query");
  assert.equal(classifyMessage("继续").task_type, "general");
});

test("Chinese edit intent wins over embedded query words", () => {
  assert.equal(classifyMessage("修复为什么登录失败的问题").task_type, "edit");
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
