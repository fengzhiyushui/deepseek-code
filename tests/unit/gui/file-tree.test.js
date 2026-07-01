import test from "node:test";
import assert from "node:assert/strict";
import { buildTree } from "../../../gui/src/state/file-tree.js";

test("buildTree nests paths; dirs first then alphabetical", () => {
  const t = buildTree(["src/index.js", "README.md", "src/core/x.js"]);
  assert.equal(t[0].name, "src");
  assert.equal(t[0].type, "dir");
  assert.equal(t[1].name, "README.md");
  assert.equal(t[1].type, "file");
  const src = t[0].children;
  assert.equal(src[0].name, "core");
  assert.equal(src[0].type, "dir");
  assert.equal(src[1].name, "index.js");
  assert.equal(src[1].type, "file");
  assert.equal(src[0].children[0].path, "src/core/x.js");
});

test("buildTree empty → []", () => {
  assert.deepEqual(buildTree([]), []);
  assert.deepEqual(buildTree(null), []);
});
