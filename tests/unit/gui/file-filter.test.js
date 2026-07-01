import test from "node:test";
import assert from "node:assert/strict";
import { filterTree } from "../../../gui/src/state/file-filter.js";

const tree = [
  { name: "src", type: "dir", path: "src", children: [
    { name: "index.js", type: "file", path: "src/index.js" },
    { name: "config.js", type: "file", path: "src/config.js" }
  ] },
  { name: "README.md", type: "file", path: "README.md" }
];

test("empty query returns all", () => { assert.equal(filterTree(tree, ""), tree); });

test("substring keeps matches + parent dirs", () => {
  const f = filterTree(tree, "index");
  assert.equal(f.length, 1);
  assert.equal(f[0].name, "src");
  assert.equal(f[0].children.length, 1);
  assert.equal(f[0].children[0].name, "index.js");
});

test("no match returns empty", () => { assert.deepEqual(filterTree(tree, "zzz"), []); });
