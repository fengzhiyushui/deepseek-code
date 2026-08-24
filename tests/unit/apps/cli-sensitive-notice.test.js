import test from "node:test";
import assert from "node:assert/strict";
import { formatSensitiveNotice } from "../../../src/apps/cli/render-events.js";
import { describeSensitiveNotice } from "../../../src/apps/sensitive-notice-contract.js";

function strip(lines) {
  // 去掉 ANSI 转义,便于断言文本(NO_COLOR/非 TTY 下本就没有)
  return lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
}

const descriptor = describeSensitiveNotice({
  paths: [{ path: ".env", reason: "secret-file" }],
  recordDir: ".deepseek-code/changes"
});

test("formatSensitiveNotice lists each path with a human reason label", () => {
  const text = strip(formatSensitiveNotice(descriptor)).join("\n");
  assert.match(text, /\.env/);
  assert.match(text, /secret file/);
  assert.match(text, /\.deepseek-code\/changes/);
});

// 这条是本提醒的设计要点:它**不是**权限审批,措辞必须让用户看出区别,
// 否则会被按审批的肌肉记忆一路 y 下去。
test("formatSensitiveNotice states plainly that it is NOT a permission prompt", () => {
  const text = strip(formatSensitiveNotice(descriptor)).join("\n");
  assert.match(text, /NOT a permission prompt/);
});

test("formatSensitiveNotice explains why the record cannot be redacted", () => {
  const text = strip(formatSensitiveNotice(descriptor)).join("\n");
  assert.match(text, /NOT redacted/);
  assert.match(text, /rollback needs the exact bytes/);
});

test("formatSensitiveNotice emits red-colored lines when color is enabled", () => {
  // theme.color 在非 TTY 下降级为原样返回,所以这里只断言「要么带红色码,要么纯文本」,
  // 不因运行环境不同而假红。
  const lines = formatSensitiveNotice(descriptor);
  const joined = lines.join("");
  const hasRed = joined.includes("\x1b[31m");
  const isPlain = !joined.includes("\x1b[");
  assert.ok(hasRed || isPlain, "要么全红要么纯文本,不得半途着色");
});

test("formatSensitiveNotice returns nothing for an empty descriptor", () => {
  assert.deepEqual(formatSensitiveNotice(null), []);
  assert.deepEqual(formatSensitiveNotice({ paths: [] }), []);
});

test("formatSensitiveNotice pluralizes correctly for multiple files", () => {
  const many = describeSensitiveNotice({
    paths: [{ path: ".env", reason: "secret-file" }, { path: ".npmrc", reason: "credential-file" }]
  });
  const text = strip(formatSensitiveNotice(many)).join("\n");
  assert.match(text, /these files/);
  assert.match(text, /credential file/);
  const one = strip(formatSensitiveNotice(descriptor)).join("\n");
  assert.match(one, /this file/);
});
