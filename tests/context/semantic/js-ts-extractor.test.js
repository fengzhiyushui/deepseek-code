import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { extractParseResult, makeSymbolId } from "../../../src/context/semantic/js-ts-extractor.js";

const provider = createWasmTreeSitterProvider();
const parseTree = (file, src) => provider.parseTree(file, src);

const SRC = `import { foo } from "./foo.js";
import bar from "./bar.js";
export function main() { foo(); bar(); obj.run(); }
export class Service {}
`;

test("makeSymbolId is the stable documented format", () => {
  assert.equal(makeSymbolId({ file: "src/a.js", kind: "function", name: "main", startLine: 3 }),
    "src/a.js#function:main:3");
});

test("extractor pulls symbols/imports/exports/raw calls", async () => {
  await provider.load();
  const r = extractParseResult({ file: "src/a.js", source: SRC, parseTree });
  assert.equal(r.ok, true);
  const names = r.symbols.map((s) => s.name).sort();
  assert.deepEqual(names, ["Service", "main"]);
  assert.equal(r.symbols.find((s) => s.name === "main").exported, true);
  assert.deepEqual(r.imports.map((i) => i.source_spec).sort(), ["./bar.js", "./foo.js"]);
  // raw calls inside main: foo (identifier), bar (identifier), obj.run (member)
  const kinds = r.calls.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["identifier", "identifier", "member"]);
  assert.ok(r.calls.every((c) => c.caller_symbol_id.startsWith("src/a.js#function:main:")));
});

test("extractor returns ok:false on parse failure", () => {
  const r = extractParseResult({ file: "a.py", source: "x=1", parseTree: () => ({ ok: false }) });
  assert.equal(r.ok, false);
  assert.deepEqual(r.symbols, []);
});
