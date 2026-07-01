import test from "node:test";
import assert from "node:assert/strict";
import { isLivePanel } from "../../../gui/src/state/panels.js";

test("chat/timeline/status are live", () => {
  assert.equal(isLivePanel("chat", {}), true);
  assert.equal(isLivePanel("timeline", {}), true);
  assert.equal(isLivePanel("status", {}), true);
});

test("filetree/editor/terminal are always placeholders in D-1", () => {
  assert.equal(isLivePanel("filetree", { activity: [{ type: "x" }] }), false);
  assert.equal(isLivePanel("editor", {}), false);
  assert.equal(isLivePanel("terminal", {}), false);
});

test("toolcards are live only when activity exists", () => {
  assert.equal(isLivePanel("toolcards", { activity: [{ type: "tool:call" }] }), true);
  assert.equal(isLivePanel("toolcards", { activity: [] }), false);
  assert.equal(isLivePanel("toolcards", {}), false);
});
