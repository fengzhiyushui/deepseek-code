import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { extractWithDef } from "../../../src/context/semantic/query-extractor.js";
import { makeSymbolId } from "../../../src/context/semantic/js-ts-extractor.js";

// minimal JS def: only top-level function symbols + identifier calls
const miniDef = {
  language: "js",
  callablePriority: { method: 0, function: 1, variable: 2, class: 3 },
  query: `(function_declaration) @fn
          (call_expression function: (identifier) @callee) @call`,
  handleMatch(group, ctx) {
    if (group.has("fn")) {
      const node = group.get("fn")[0];
      const name = node.childForFieldName("name")?.text;
      if (!name) return null;
      return { symbol: {
        symbol_id: makeSymbolId({ file: ctx.file, kind: "function", name, startLine: node.startPosition.row + 1 }),
        file: ctx.file, name, kind: "function",
        range: { start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 },
        exported: false, _node: node
      } };
    }
    if (group.has("call")) {
      const node = group.get("call")[0];
      return { rawCall: { _node: node, callee_raw: group.get("callee")[0].text, kind: "identifier", file: ctx.file, line: node.startPosition.row + 1 } };
    }
    return null;
  }
};

test("runner assembles symbols + calls; enclosing-symbol by smallest range", async () => {
  const provider = createWasmTreeSitterProvider();
  await provider.load();
  const source = "function outer(){ function inner(){ foo(); } }";
  const { tree } = provider.parseTree("a.js", source);
  const query = provider.compileQuery("js", miniDef.query);
  const r = extractWithDef({ file: "src/a.js", source, tree, query, def: miniDef });
  assert.equal(r.ok, true);
  assert.deepEqual(r.symbols.map((s) => s.name).sort(), ["inner", "outer"]);
  // foo() is inside inner -> enclosing is inner (smallest byte range), not outer
  assert.equal(r.calls.length, 1);
  assert.ok(r.calls[0].caller_symbol_id.includes("#function:inner:"));
  // no _node leaks into output
  assert.equal("_node" in r.symbols[0], false);
});

test("extractParseResult degrades to ok:false when no def in registry", async () => {
  const provider = createWasmTreeSitterProvider();
  await provider.load();
  const { extractParseResult } = await import("../../../src/context/semantic/query-extractor.js");
  const registry = new Map(); // empty -> no def for js
  const r = extractParseResult({ file: "src/a.js", source: "function f(){}", provider, registry });
  assert.equal(r.ok, false);
  assert.deepEqual(r.symbols, []);
  assert.deepEqual(r.calls, []);
});
