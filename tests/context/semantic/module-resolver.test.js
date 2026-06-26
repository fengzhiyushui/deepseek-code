import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModule } from "../../../src/context/semantic/module-resolver.js";

const fileSet = new Set(["src/foo.js", "src/bar/index.ts", "src/baz.ts"]);

test("resolves relative specifiers with extension/index completion", () => {
  assert.equal(resolveModule({ fromFile: "src/a.js", spec: "./foo", fileSet }), "src/foo.js");
  assert.equal(resolveModule({ fromFile: "src/a.js", spec: "./foo.js", fileSet }), "src/foo.js");
  assert.equal(resolveModule({ fromFile: "src/a.js", spec: "./bar", fileSet }), "src/bar/index.ts");
  assert.equal(resolveModule({ fromFile: "src/x/a.js", spec: "../baz", fileSet }), "src/baz.ts");
});

test("bare and alias specifiers are external -> null", () => {
  assert.equal(resolveModule({ fromFile: "src/a.js", spec: "react", fileSet }), null);
  assert.equal(resolveModule({ fromFile: "src/a.js", spec: "@/foo", fileSet }), null);
  assert.equal(resolveModule({ fromFile: "src/a.js", spec: "./missing", fileSet }), null);
});
