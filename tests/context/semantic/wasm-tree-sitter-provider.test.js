import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";

test("provider parses JS into a tree", async () => {
  const p = createWasmTreeSitterProvider();
  assert.equal(p.supports(".js"), true);
  assert.equal(p.supports(".py"), true);
  assert.equal(p.supports(".rb"), false);
  await p.load();
  const out = p.parseTree("a.js", "function main(){ foo(); }");
  assert.equal(out.ok, true);
  assert.equal(out.language, "js");
  assert.equal(out.tree.rootNode.type, "program");
});

test("provider returns ok:false on a grammar-load failure path", async () => {
  const p = createWasmTreeSitterProvider({ grammarsDir: "does/not/exist" });
  const out = await p.load().then(() => p.parseTree("a.js", "x")).catch(() => ({ ok: false }));
  assert.equal(out.ok, false);
});
