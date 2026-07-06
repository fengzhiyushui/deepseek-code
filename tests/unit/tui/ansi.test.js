// tests/unit/tui/ansi.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { seq, displayWidth, truncateToWidth, padToWidth } from "../../../src/apps/tui/ansi.js";

test("seq builders emit VT sequences", () => {
  assert.equal(seq.up(3), "\x1b[3A");
  assert.equal(seq.up(0), "");
  assert.equal(seq.down(2), "\x1b[2B");
  assert.equal(seq.col(5), "\x1b[5G");
  assert.equal(seq.clearDown, "\x1b[J");
  assert.equal(seq.pasteOn, "\x1b[?2004h");
  assert.equal(seq.pasteOff, "\x1b[?2004l");
});

test("displayWidth counts CJK as 2 columns", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("a中b"), 4);
  assert.equal(displayWidth(""), 0);
});

test("truncateToWidth cuts by display width", () => {
  assert.equal(truncateToWidth("hello", 10), "hello");
  assert.equal(truncateToWidth("hello", 4), "hell");
  assert.equal(truncateToWidth("中文字", 4), "中文");
  assert.equal(truncateToWidth("中文字", 5), "中文"); // 半列放不下宽字符
});

test("padToWidth pads with spaces to target width", () => {
  assert.equal(padToWidth("ab", 4), "ab  ");
  assert.equal(padToWidth("中", 4), "中  ");
  assert.equal(padToWidth("abcde", 3), "abcde"); // 不截断,只负责补
});
