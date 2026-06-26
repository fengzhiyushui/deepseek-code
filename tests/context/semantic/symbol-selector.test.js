import { test } from "node:test";
import assert from "node:assert/strict";
import { selectSymbolUnits } from "../../../src/context/semantic/symbol-selector.js";

const mainSym = { symbol_id: "src/a.js#function:main:1", file: "src/a.js", name: "main", kind: "function", range: { start_line: 1, end_line: 1 }, exported: true };
const fooSym = { symbol_id: "src/b.js#function:foo:1", file: "src/b.js", name: "foo", kind: "function", range: { start_line: 1, end_line: 1 }, exported: true };
const symbolTable = new Map([[mainSym.symbol_id, mainSym], [fooSym.symbol_id, fooSym]]);
const sources = new Map([["src/a.js", "function main(){ foo(); }"], ["src/b.js", "function foo(){}"]]);
const graph = { neighbors: (id) => (id === mainSym.symbol_id ? new Set([fooSym.symbol_id]) : new Set()) };

test("seeds on mentioned symbol name and expands to neighbor", () => {
  const out = selectSymbolUnits({
    message: "please look at main", symbolTable, byFile: new Map(), graph, sources,
    pinned: new Set(), warmed: new Map(), budget: 10000, hops: 1, maxSymbols: 50
  });
  const names = out.selected.map((u) => u.name).sort();
  assert.deepEqual(names, ["foo", "main"]);
  const main = out.selected.find((u) => u.name === "main");
  assert.equal(main.priority, 1);             // seed
  assert.equal(out.selected.find((u) => u.name === "foo").priority, 2); // neighbor
});

test("budget caps selection", () => {
  const out = selectSymbolUnits({
    message: "main", symbolTable, byFile: new Map(), graph, sources,
    pinned: new Set(), warmed: new Map(), budget: 1, hops: 1, maxSymbols: 50
  });
  assert.equal(out.selected.length, 0);
});
