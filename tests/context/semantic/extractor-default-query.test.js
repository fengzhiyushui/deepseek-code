import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os"; import path from "node:path"; import { promises as fs } from "node:fs";
import { createSymbolCache } from "../../../src/context/semantic/symbol-cache.js";
import { createWasmTreeSitterProvider } from "../../../src/context/semantic/wasm-tree-sitter-provider.js";
import { createLanguageRegistry } from "../../../src/context/semantic/language-registry.js";
import { indexSymbols } from "../../../src/context/semantic/symbol-indexer.js";

test("indexer default uses query-extractor; legacy flag matches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "idx-q-"));
  const provider = createWasmTreeSitterProvider(); await provider.load();
  const registry = createLanguageRegistry();
  const records = new Map([["src/a.js", { path: "src/a.js", hash: "sha256:a" }]]);
  const sources = { "src/a.js": "export function main(){ foo(); }" };
  const readFile = async (f) => sources[f];
  const viaQuery = await indexSymbols({ root, records, provider, registry, cache: createSymbolCache({ cacheRoot: root + "/q" }), readFile });
  const viaLegacy = await indexSymbols({ root, records, provider, registry, cache: createSymbolCache({ cacheRoot: root + "/l" }), readFile, useLegacyExtractor: true });
  assert.ok([...viaQuery.symbolTable.values()].some((s) => s.name === "main"));
  assert.deepEqual([...viaQuery.symbolTable.keys()].sort(), [...viaLegacy.symbolTable.keys()].sort());
});
