import { test } from "node:test";
import assert from "node:assert/strict";
import { createSemanticEngine } from "../../../src/context/semantic/semantic-engine.js";

test("disabled engine: index is a no-op and select returns null", async () => {
  const eng = createSemanticEngine({ root: process.cwd(), options: {}, eventBus: null });
  assert.equal(eng.enabled, false);
  await eng.index(new Map());           // no-op, must not throw
  assert.equal(eng.select({ message: "x", pinned: new Set(), warmed: new Map(), budget: 1000 }), null);
});
