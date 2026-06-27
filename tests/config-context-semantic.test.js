import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, DEFAULT_CONFIG } from "../src/config.js";

test("defaults: semantic disabled", () => {
  assert.equal(DEFAULT_CONFIG.context.semantic.enabled, false);
  assert.equal(DEFAULT_CONFIG.context.semantic.hops, 2);
});

test("normalizeContext coerces and fills defaults", () => {
  const c = normalizeContext({ semantic: { enabled: true, hops: 0, maxSymbols: "x" } });
  assert.equal(c.semantic.enabled, true);
  assert.equal(c.semantic.hops, 2);        // 0/invalid -> default
  assert.equal(c.semantic.maxSymbols, 200);
  assert.equal(c.semantic.includeMethodHints, false);
});

test("normalizeContext on empty -> defaults", () => {
  assert.deepEqual(normalizeContext(), { semantic: { enabled: false, hops: 2, maxSymbols: 200, includeMethodHints: false, languages: ["js", "ts", "py"], importRoots: [] } });
});
