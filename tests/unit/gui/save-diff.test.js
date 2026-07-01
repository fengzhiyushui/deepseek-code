import test from "node:test";
import assert from "node:assert/strict";
import { wholeFileDiff } from "../../../gui/src/state/save-diff.js";

test("before equals after produces empty diff (nothing to save)", () => {
  assert.equal(wholeFileDiff("a.js", "x\n", "x\n"), "");
});

test("diff has file headers, hunk, and -old/+new lines", () => {
  const d = wholeFileDiff("a.js", "one\ntwo", "one\nTWO");
  assert.match(d, /--- a\/a\.js/);
  assert.match(d, /\+\+\+ b\/a\.js/);
  assert.match(d, /@@ -1,2 \+1,2 @@/);
  assert.match(d, /-two/);
  assert.match(d, /\+TWO/);
});
