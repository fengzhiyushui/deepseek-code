import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, applyWorkbenchAction } from "../../../gui/src/state/workbench-state.js";

const NOTICE_EVENT = {
  type: "gui:sensitive_notice",
  request_id: "sn_1",
  descriptor: {
    kind: "sensitive-file-write",
    severity: "danger",
    paths: [{ path: ".env", reason: "secret-file", reasonKey: "sensitive.reason.secret" }],
    recordDir: ".deepseek-code/changes",
    count: 1
  }
};

test("sensitive notice event lands in its own state field", () => {
  const base = createInitialState();
  assert.equal(base.sensitiveNotice, null);

  const next = applyWorkbenchAction(base, { type: "event_received", event: NOTICE_EVENT });
  assert.equal(next.sensitiveNotice.requestId, "sn_1");
  assert.equal(next.sensitiveNotice.descriptor.paths[0].path, ".env");
});

// 关键:它不是审批,不得写 approval,也不得把检查器切到审批分区 ——
// 否则用户会按审批的肌肉记忆处理它。
test("sensitive notice does not touch approval state or inspector mode", () => {
  const base = createInitialState();
  const next = applyWorkbenchAction(base, { type: "event_received", event: NOTICE_EVENT });
  assert.equal(next.approval, null, "不得写进 approval 态");
  assert.equal(next.inspectorMode, base.inspectorMode, "不得切换检查器分区");
});

test("approval events still behave as before", () => {
  const base = createInitialState();
  const next = applyWorkbenchAction(base, {
    type: "event_received",
    event: { type: "approval:requested", approval: { id: "ap1" } }
  });
  assert.equal(next.approval.id, "ap1");
  assert.equal(next.inspectorMode, "approval");
  assert.equal(next.sensitiveNotice, null, "普通审批不得点亮敏感提醒");
});

test("sensitive_notice_cleared clears only that field", () => {
  let s = createInitialState();
  s = applyWorkbenchAction(s, { type: "event_received", event: { type: "approval:requested", approval: { id: "ap1" } } });
  s = applyWorkbenchAction(s, { type: "event_received", event: NOTICE_EVENT });
  s = applyWorkbenchAction(s, { type: "sensitive_notice_cleared" });
  assert.equal(s.sensitiveNotice, null);
  assert.equal(s.approval.id, "ap1", "清提醒不得连带清掉审批");
});

test("reducer stays immutable for the new action", () => {
  const base = createInitialState();
  const next = applyWorkbenchAction(base, { type: "event_received", event: NOTICE_EVENT });
  assert.notEqual(next, base);
  assert.equal(base.sensitiveNotice, null, "原状态不得被就地修改");
});
