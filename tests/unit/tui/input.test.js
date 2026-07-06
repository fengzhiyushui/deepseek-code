// tests/unit/tui/input.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createKeyDecoder } from "../../../src/apps/tui/input.js";

test("printable runs coalesce into one char event (incl. CJK)", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("ab中"), [{ type: "char", text: "ab中" }]);
});

test("control keys decode", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\r"), [{ type: "enter" }]);
  assert.deepEqual(d.feed("\x7f"), [{ type: "backspace" }]);
  assert.deepEqual(d.feed("\t"), [{ type: "tab" }]);
  assert.deepEqual(d.feed("\x03"), [{ type: "ctrl_c" }]);
});

test("CSI arrows/home/end decode; unknown CSI dropped", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1b[A\x1b[B\x1b[C\x1b[D"), [
    { type: "up" }, { type: "down" }, { type: "right" }, { type: "left" }
  ]);
  assert.deepEqual(d.feed("\x1b[H"), [{ type: "home" }]);
  assert.deepEqual(d.feed("\x1b[F"), [{ type: "end" }]);
  assert.deepEqual(d.feed("\x1b[1~"), [{ type: "home" }]);
  assert.deepEqual(d.feed("\x1b[4~"), [{ type: "end" }]);
  assert.deepEqual(d.feed("\x1b[5~"), []); // PgUp 未映射,丢弃
});

test("escape sequence split across chunks buffers", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1b"), []);
  assert.deepEqual(d.feed("[A"), [{ type: "up" }]);
});

test("lone ESC followed by printable yields esc + char", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1bx"), [{ type: "esc" }, { type: "char", text: "x" }]);
});

test("SS3 sequence split across chunks buffers", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1bO"), []);
  assert.deepEqual(d.feed("A"), [{ type: "up" }]);
});

test("unknown complete SS3 dropped silently", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1bOPx"), [{ type: "char", text: "x" }]);
});

test("paste terminator split mid-sequence reassembles", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1b[200~ab\x1b[20"), []);
  assert.deepEqual(d.feed("1~c"), [{ type: "paste", text: "ab" }, { type: "char", text: "c" }]);
});

test("bracketed paste accumulates across chunks", () => {
  const d = createKeyDecoder();
  assert.deepEqual(d.feed("\x1b[200~he"), []);
  assert.deepEqual(d.feed("llo\nwo"), []);
  assert.deepEqual(d.feed("rld\x1b[201~z"), [
    { type: "paste", text: "hello\nworld" },
    { type: "char", text: "z" }
  ]);
});
