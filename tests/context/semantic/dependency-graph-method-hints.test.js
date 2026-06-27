import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDependencyGraph } from "../../../src/context/semantic/dependency-graph.js";

// caller `use` makes 4 member calls: obj.uniqueFn(), obj.dupFn(), obj.Widget(), obj.uniqueMethod()
const useSym = { symbol_id: "src/a.js#function:use:1", file: "src/a.js", name: "use", kind: "function", range: { start_line: 1, end_line: 4 }, exported: true };
const uniqueFn = { symbol_id: "src/b.js#function:uniqueFn:1", file: "src/b.js", name: "uniqueFn", kind: "function", range: { start_line: 1, end_line: 1 }, exported: true };
const dup1 = { symbol_id: "src/b.js#function:dupFn:2", file: "src/b.js", name: "dupFn", kind: "function", range: { start_line: 2, end_line: 2 }, exported: true };
const dup2 = { symbol_id: "src/c.js#function:dupFn:1", file: "src/c.js", name: "dupFn", kind: "function", range: { start_line: 1, end_line: 1 }, exported: true };
const widget = { symbol_id: "src/b.js#class:Widget:3", file: "src/b.js", name: "Widget", kind: "class", range: { start_line: 3, end_line: 3 }, exported: true };
const uniqueMethod = { symbol_id: "src/b.js#method:uniqueMethod:4", file: "src/b.js", name: "uniqueMethod", kind: "method", range: { start_line: 4, end_line: 4 }, exported: false };

const memberCall = (prop) => ({ caller_symbol_id: useSym.symbol_id, callee_raw: `obj.${prop}`, kind: "member", member_property: prop, file: "src/a.js", line: 2 });
const byFile = new Map([
  ["src/a.js", { file: "src/a.js", symbols: [useSym], imports: [], exports: [], ok: true,
    calls: [memberCall("uniqueFn"), memberCall("dupFn"), memberCall("Widget"), memberCall("uniqueMethod")] }],
  ["src/b.js", { file: "src/b.js", symbols: [uniqueFn, dup1, widget, uniqueMethod], imports: [], exports: [], calls: [], ok: true }],
  ["src/c.js", { file: "src/c.js", symbols: [dup2], imports: [], exports: [], calls: [], ok: true }]
]);
const symbolTable = new Map([useSym, uniqueFn, dup1, dup2, widget, uniqueMethod].map((s) => [s.symbol_id, s]));

test("methodHints OFF -> all member calls unresolved (unchanged)", () => {
  const g = buildDependencyGraph({ byFile, symbolTable });
  for (const e of g.callEdges.filter((e) => e.callee_raw.startsWith("obj."))) {
    assert.deepEqual([e.confidence, e.reason, e.callee_symbol_id], ["unresolved", "member-call", null]);
  }
  assert.equal(g.neighbors(useSym.symbol_id, { hops: 1 }).size, 0);
});

test("methodHints ON -> unique callable match -> probable; dup/class -> unresolved", () => {
  const g = buildDependencyGraph({ byFile, symbolTable, methodHints: true });
  const byRaw = Object.fromEntries(g.callEdges.map((e) => [e.callee_raw, e]));
  assert.deepEqual([byRaw["obj.uniqueFn"].confidence, byRaw["obj.uniqueFn"].reason, byRaw["obj.uniqueFn"].callee_symbol_id],
    ["probable", "member-call", uniqueFn.symbol_id]);
  assert.deepEqual([byRaw["obj.uniqueMethod"].confidence, byRaw["obj.uniqueMethod"].callee_symbol_id],
    ["probable", uniqueMethod.symbol_id]);                 // method kind is callable
  assert.equal(byRaw["obj.dupFn"].confidence, "unresolved"); // 2 matches -> ambiguous
  assert.equal(byRaw["obj.Widget"].confidence, "unresolved"); // class excluded from nameIndex
  const nb = g.neighbors(useSym.symbol_id, { hops: 1, direction: "out" });
  assert.equal(nb.get(uniqueFn.symbol_id), "probable");
  assert.equal(nb.has(widget.symbol_id), false);
});
