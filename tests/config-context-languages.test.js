import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, DEFAULT_CONFIG } from "../src/config.js";

test("defaults include js/ts/py + empty importRoots", () => {
  assert.deepEqual(DEFAULT_CONFIG.context.semantic.languages, ["js", "ts", "py"]);
  assert.deepEqual(DEFAULT_CONFIG.context.semantic.importRoots, []);
});

test("normalizeContext filters languages to whitelist + cleans importRoots", () => {
  const c = normalizeContext({ semantic: { languages: ["js", "ruby", "py", "js"], importRoots: ["src", "", 3, "lib"] } });
  assert.deepEqual(c.semantic.languages, ["js", "py"]);     // whitelist + dedupe, order preserved
  assert.deepEqual(c.semantic.importRoots, ["src", "lib"]); // strings, non-empty
});

test("normalizeContext falls back to default languages when not an array", () => {
  const c = normalizeContext({ semantic: { languages: "nope" } });
  assert.deepEqual(c.semantic.languages, ["js", "ts", "py"]);
  assert.deepEqual(c.semantic.importRoots, []);
});
