import { test } from "node:test";
import assert from "node:assert/strict";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { extractParseResult as oldExtract } from "../../../src/context/semantic/js-ts-extractor.js";
import { extractWithDef } from "../../../src/context/semantic/query-extractor.js";
import { tsLanguageDef } from "../../../src/context/semantic/languages/typescript.js";

// TS shadow-parity: same multiset oracle as parity-js, on .ts sources (ts grammar).
// interface/type must NOT enter symbols on either side (maintained-not-modeled).
// Class fixture is multi-line so the runner's byte-range enclosing and the legacy
// line-range enclosing agree (they diverge only on identical-line nesting).
const CORPUS = [
  `export function f(x: number): string { return g(x); }\ninterface I { a: number }\ntype T = number;`,
  `class S {\n  run(): void { this.helper(); }\n  private helper(){}\n}`,
  `import type { T } from "./t.js";\nimport { v } from "./v.js";\nexport const h = (n: number) => n + 1;`
];

function ms(list) {
  return list.map((e) => JSON.stringify(e, Object.keys(e).sort())).sort();
}

const provider = createWasmTreeSitterProvider();

test("TS query-extractor is multiset-equal to js-ts-extractor across the corpus", async () => {
  await provider.load();
  const query = provider.compileQuery("ts", tsLanguageDef.query);
  for (const [i, source] of CORPUS.entries()) {
    const file = `src/c${i}.ts`;
    const oldR = oldExtract({ file, source, parseTree: (f, s) => provider.parseTree(f, s) });
    const { tree } = provider.parseTree(file, source);
    const newR = extractWithDef({ file, source, tree, query, def: tsLanguageDef });
    for (const field of ["symbols", "imports", "exports", "calls"]) {
      assert.deepEqual(ms(newR[field]), ms(oldR[field]), `field=${field} fixture=${i}`);
    }
  }
});

test("interface/type are not modeled as symbols (both old and query)", async () => {
  await provider.load();
  const query = provider.compileQuery("ts", tsLanguageDef.query);
  const source = "interface I { a: number }\ntype T = number;\nexport function real(){}";
  const { tree } = provider.parseTree("src/x.ts", source);
  const newR = extractWithDef({ file: "src/x.ts", source, tree, query, def: tsLanguageDef });
  assert.deepEqual(newR.symbols.map((s) => s.name).sort(), ["real"]);
});
