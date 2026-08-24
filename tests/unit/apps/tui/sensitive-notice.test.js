import test from "node:test";
import assert from "node:assert/strict";
import { initialTuiState, reduce } from "../../../../src/apps/tui/tui-state.js";
import { computeBottom } from "../../../../src/apps/tui/paint.js";
import { makeT } from "../../../../src/apps/tui/tui-i18n.js";

const t = makeT("zh");
const NOTICE = {
  kind: "sensitive-file-write",
  severity: "danger",
  paths: [{ path: ".env", reason: "secret-file", reasonKey: "sensitive.reason.secret" }],
  recordDir: ".deepseek-code/changes",
  count: 1
};

test("sensitive_notice is a state field distinct from approval", () => {
  const base = initialTuiState({});
  assert.equal(base.sensitiveNotice, null);

  const withNotice = reduce(base, { type: "sensitive_notice", notice: NOTICE });
  assert.deepEqual(withNotice.sensitiveNotice, NOTICE);
  // 关键:不得污染 approval 态 —— 它不是审批
  assert.equal(withNotice.approval, null, "敏感提醒不得写进 approval 态");

  const cleared = reduce(withNotice, { type: "sensitive_notice", notice: null });
  assert.equal(cleared.sensitiveNotice, null);
});

test("approval and sensitive notice do not overwrite each other", () => {
  let s = initialTuiState({});
  s = reduce(s, { type: "approval", approval: { id: "ap1" } });
  s = reduce(s, { type: "sensitive_notice", notice: NOTICE });
  assert.equal(s.approval.id, "ap1");
  assert.equal(s.sensitiveNotice.count, 1);
  // 清掉提醒不应影响审批
  s = reduce(s, { type: "sensitive_notice", notice: null });
  assert.equal(s.approval.id, "ap1");
});

// 注:TUI 颜色在非 TTY 下按设计降级(theme.js 的 supportsColor),且用 256 色
// 序列。断言 ANSI 码等于在测运行环境而非测代码,故这里断言**文本内容** ——
// 底部行用的是哪个 i18n key,才是环境无关的真实行为。
test("bottom input line shows the sensitive prompt and takes priority over approval", () => {
  let s = initialTuiState({});
  s = reduce(s, { type: "approval", approval: { id: "ap1" } });
  s = reduce(s, { type: "sensitive_notice", notice: NOTICE });

  const bottom = computeBottom(s, t, 80);
  const inputLine = bottom.lines[bottom.lines.length - 2];
  assert.match(inputLine, /敏感文件/, "应渲染 input.sensitive");
  assert.doesNotMatch(inputLine, /^ 审批/, "不得退化成普通审批提示");
});

test("approval line is unchanged when no sensitive notice is pending", () => {
  let s = initialTuiState({});
  s = reduce(s, { type: "approval", approval: { id: "ap1" } });
  const bottom = computeBottom(s, t, 80);
  const inputLine = bottom.lines[bottom.lines.length - 2];
  assert.match(inputLine, /审批/, "普通审批提示不受本片影响");
  assert.doesNotMatch(inputLine, /敏感文件/);
});

test("zh and en both provide every sensitive-notice key", () => {
  const keys = [
    "input.sensitive", "sensitive.title", "sensitive.body",
    "sensitive.reason.secret", "sensitive.reason.credential", "sensitive.reason.other"
  ];
  for (const lang of ["zh", "en"]) {
    const tr = makeT(lang);
    for (const k of keys) assert.notEqual(tr(k), k, `${lang} 缺 ${k}`);
  }
});
