import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { extractWithDef } from "../../../src/context/semantic/query-extractor.js";
import { pythonLanguageDef } from "../../../src/context/semantic/languages/python.js";

const provider = createWasmTreeSitterProvider();
async function extract(file, source) {
  await provider.load();
  const { tree } = provider.parseTree(file, source);
  const q = provider.compileQuery("py", pythonLanguageDef.query);
  return extractWithDef({ file, source, tree, query: q, def: pythonLanguageDef });
}

test("module-level fn/class exported:true; method exported:false", async () => {
  const r = await extract("pkg/m.py", "def top():\n    helper()\nclass S:\n    def run(self):\n        self.x()\ndef helper():\n    pass");
  const byName = Object.fromEntries(r.symbols.map((s) => [s.name, s]));
  assert.equal(byName.top.kind, "function");
  assert.equal(byName.top.exported, true);
  assert.equal(byName.S.kind, "class");
  assert.equal(byName.S.exported, true);
  assert.equal(byName.run.kind, "method");
  assert.equal(byName.run.exported, false);
  assert.equal(byName.helper.exported, true);
  // direct call top()->helper captured; self.x() member with property x
  assert.ok(r.calls.some((c) => c.callee_raw === "helper" && c.kind === "identifier"));
  assert.ok(r.calls.some((c) => c.kind === "member" && c.member_property === "x"));
  // helper() is enclosed by top
  const helperCall = r.calls.find((c) => c.callee_raw === "helper");
  assert.ok(helperCall.caller_symbol_id.includes("#function:top:"));
  // exports always empty for Python
  assert.deepEqual(r.exports, []);
});

test("imports: relative (level + alias), absolute, bare module", async () => {
  const r = await extract("pkg/m.py", "from .sub import a as b, c\nimport os\nfrom pkg.mod import d");
  const specs = r.imports.map((i) => i.source_spec).sort();
  assert.ok(specs.includes("os"));
  assert.ok(specs.includes("sub"));
  assert.ok(specs.includes("pkg.mod"));
  const rel = r.imports.find((i) => i.names.some((n) => n.local === "b"));
  assert.equal(rel.level, 1);
  assert.equal(rel.names.find((n) => n.local === "b").imported, "a");
  assert.ok(rel.names.some((n) => n.imported === "c" && n.local === "c"));
  const abs = r.imports.find((i) => i.source_spec === "pkg.mod");
  assert.equal(abs.level, 0);
  assert.equal(abs.names[0].imported, "d");
  const bare = r.imports.find((i) => i.source_spec === "os");
  assert.equal(bare.level, 0);
  assert.deepEqual(bare.names, []);
});

test("from . import x -> level 1, empty spec", async () => {
  const r = await extract("pkg/m.py", "from . import x");
  assert.equal(r.imports.length, 1);
  assert.equal(r.imports[0].level, 1);
  assert.equal(r.imports[0].source_spec, "");
  assert.equal(r.imports[0].names[0].imported, "x");
});
