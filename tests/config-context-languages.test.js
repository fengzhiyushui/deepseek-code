import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, DEFAULT_CONFIG } from "../src/config.js";

test("defaults no longer have languages key", () => {
  assert.equal("languages" in DEFAULT_CONFIG.context.semantic, false);
  assert.deepEqual(DEFAULT_CONFIG.context.semantic.importRoots, []);
});

test("normalizeContext drops languages key from old config — key silently disappears", () => {
  const c = normalizeContext({ semantic: { languages: ["js", "ruby", "py", "js"], importRoots: ["src", "lib"] } });
  assert.equal("languages" in c.semantic, false);
  assert.deepEqual(c.semantic.importRoots, ["src", "lib"]);
});

test("normalizeContext ignores languages even when present", () => {
  const c = normalizeContext({ semantic: { languages: "nope" } });
  // Other keys are unaffected.
  assert.equal(c.semantic.enabled, false);
  assert.equal(c.semantic.hops, 2);
  assert.deepEqual(c.semantic.importRoots, []);
});

test("normalizeContext still works with old-style config containing languages", () => {
  const c = normalizeContext({ semantic: { enabled: true, languages: ["py"], importRoots: [] } });
  assert.equal(c.semantic.enabled, true);
  assert.equal("languages" in c.semantic, false);
});
