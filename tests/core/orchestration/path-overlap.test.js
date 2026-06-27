import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePath, overlaps, withinScope } from "../../../src/core/orchestration/path-overlap.js";

test("normalizePath unifies separators and strips ./", () => {
  assert.equal(normalizePath("./src\\a.js"), normalizePath("src/a.js"));
});

test("overlaps detects equality and directory containment", () => {
  assert.equal(overlaps(["src/a.js"], ["src/b.js"]), false);
  assert.equal(overlaps(["src/a.js"], ["src/a.js"]), true);
  assert.equal(overlaps(["src/"], ["src/a.js"]), true);   // dir contains file
  assert.equal(overlaps(["lib/x.js"], ["src/"]), false);
});

test("withinScope returns out-of-scope paths", () => {
  assert.deepEqual(withinScope(["src/a.js"], ["src/"]), []);          // a.js inside src/
  assert.deepEqual(withinScope(["src/a.js", "lib/b.js"], ["src/a.js"]), ["lib/b.js"]);
});
