import test from "node:test";
import assert from "node:assert/strict";
import { layoutForWidth } from "../../../gui/src/state/layout.js";

test("breakpoints toggle panels (760 rail / 1060 chat / 1340 sidebar)", () => {
  assert.deepEqual(layoutForWidth(1400), { rail: true, sidebar: true, chat: true });
  assert.deepEqual(layoutForWidth(1200), { rail: true, sidebar: false, chat: true });
  assert.deepEqual(layoutForWidth(900), { rail: true, sidebar: false, chat: false });
  assert.deepEqual(layoutForWidth(700), { rail: false, sidebar: false, chat: false });
});

test("exact breakpoint boundaries are inclusive", () => {
  assert.equal(layoutForWidth(760).rail, true);
  assert.equal(layoutForWidth(759).rail, false);
  assert.equal(layoutForWidth(1060).chat, true);
  assert.equal(layoutForWidth(1059).chat, false);
  assert.equal(layoutForWidth(1340).sidebar, true);
  assert.equal(layoutForWidth(1339).sidebar, false);
});

test("non-numeric width is treated as 0 (all collapsed)", () => {
  assert.deepEqual(layoutForWidth(undefined), { rail: false, sidebar: false, chat: false });
});
