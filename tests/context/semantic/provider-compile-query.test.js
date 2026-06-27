import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";

test("compileQuery compiles + caches; unknown language -> null", async () => {
  const p = createWasmTreeSitterProvider();
  await p.load();
  const q1 = p.compileQuery("js", "(function_declaration name: (identifier) @n) @fn");
  const q2 = p.compileQuery("js", "(function_declaration name: (identifier) @n) @fn");
  assert.equal(typeof q1.matches, "function");
  assert.equal(q1, q2);                                  // cached (same instance)
  assert.equal(p.compileQuery("go", "(x) @y"), null);    // grammar not loaded
});
