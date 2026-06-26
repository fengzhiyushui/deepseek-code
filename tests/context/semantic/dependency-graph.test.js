import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDependencyGraph } from "../../../src/context/semantic/dependency-graph.js";

// Two files: a.js imports foo from b.js and calls it + calls local helper + obj.run()
const fooSym = { symbol_id: "src/b.js#function:foo:1", file: "src/b.js", name: "foo", kind: "function", range: { start_line: 1, end_line: 1 }, exported: true };
const mainSym = { symbol_id: "src/a.js#function:main:2", file: "src/a.js", name: "main", kind: "function", range: { start_line: 2, end_line: 5 }, exported: true };
const helpSym = { symbol_id: "src/a.js#function:help:6", file: "src/a.js", name: "help", kind: "function", range: { start_line: 6, end_line: 6 }, exported: false };

const byFile = new Map([
  ["src/b.js", { file: "src/b.js", symbols: [fooSym], imports: [], exports: [{ file: "src/b.js", name: "foo", local_name: "foo", kind: "named", source_spec: null }], calls: [], ok: true }],
  ["src/a.js", { file: "src/a.js", symbols: [mainSym, helpSym], ok: true,
    imports: [{ from_file: "src/a.js", source_spec: "./b.js", resolved_file: "src/b.js", names: [{ imported: "foo", local: "foo" }], default: false, namespace: false, kind: "esm", dynamic: false }],
    exports: [],
    calls: [
      { caller_symbol_id: mainSym.symbol_id, callee_raw: "foo", kind: "identifier", file: "src/a.js", line: 3 },
      { caller_symbol_id: mainSym.symbol_id, callee_raw: "help", kind: "identifier", file: "src/a.js", line: 4 },
      { caller_symbol_id: mainSym.symbol_id, callee_raw: "obj.run", kind: "member", file: "src/a.js", line: 5 }
    ] }]
]);
const symbolTable = new Map([fooSym, mainSym, helpSym].map((s) => [s.symbol_id, s]));

test("resolves import-binding, local call; marks member call unresolved", () => {
  const g = buildDependencyGraph({ byFile, symbolTable });
  const byRaw = Object.fromEntries(g.callEdges.map((e) => [e.callee_raw, e]));
  assert.deepEqual([byRaw.foo.confidence, byRaw.foo.reason, byRaw.foo.callee_symbol_id],
    ["resolved", "import-binding", fooSym.symbol_id]);
  assert.deepEqual([byRaw.help.confidence, byRaw.help.reason, byRaw.help.callee_symbol_id],
    ["resolved", "direct-local-call", helpSym.symbol_id]);
  assert.deepEqual([byRaw["obj.run"].confidence, byRaw["obj.run"].reason, byRaw["obj.run"].callee_symbol_id],
    ["unresolved", "member-call", null]);
});

test("neighbors expands resolved edges only", () => {
  const g = buildDependencyGraph({ byFile, symbolTable });
  const out = g.neighbors(mainSym.symbol_id, { hops: 1, direction: "out" });
  assert.equal(out.has(fooSym.symbol_id), true);
  assert.equal(out.has(helpSym.symbol_id), true);
});
