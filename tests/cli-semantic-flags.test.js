import { test } from "node:test";
import assert from "node:assert/strict";
import { semanticOverrideFromFlags } from "../src/cli.js";

test("--include-method-hints implies enabled + hints", () => {
  assert.deepEqual(semanticOverrideFromFlags(new Map([["include-method-hints", true]])), { enabled: true, includeMethodHints: true });
});
test("--semantic-context enables semantic only", () => {
  assert.deepEqual(semanticOverrideFromFlags(new Map([["semantic-context", true]])), { enabled: true });
});
test("no flag -> null (no override, protects disabled-parity)", () => {
  assert.equal(semanticOverrideFromFlags(new Map()), null);
});
