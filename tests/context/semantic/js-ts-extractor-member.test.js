import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { extractParseResult } from "../../../src/context/semantic/js-ts-extractor.js";

const provider = createWasmTreeSitterProvider();
const parseTree = (f, s) => provider.parseTree(f, s);

test("member calls carry member_property; computed/identifier do not", async () => {
  await provider.load();
  const src = `function main(){ obj.run(); a.b.c(); plain(); obj["x"](); }`;
  const r = extractParseResult({ file: "src/a.js", source: src, parseTree });
  const byRaw = Object.fromEntries(r.calls.map((c) => [c.callee_raw, c]));
  assert.equal(byRaw["obj.run"].kind, "member");
  assert.equal(byRaw["obj.run"].member_property, "run");
  assert.equal(byRaw["a.b.c"].member_property, "c");            // nearest property
  assert.equal(byRaw["plain"].kind, "identifier");
  assert.equal("member_property" in byRaw["plain"], false);     // identifier -> none
  assert.equal(byRaw['obj["x"]'].kind, "dynamic");              // subscript -> dynamic
  assert.equal("member_property" in byRaw['obj["x"]'], false);
});
