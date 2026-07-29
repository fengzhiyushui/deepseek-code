import path from "node:path";
import { fileURLToPath } from "node:url";
import { extensionOf } from "./parser-provider.js";

const EXT_LANG = new Map([
  [".js", "js"], [".mjs", "js"], [".cjs", "js"], [".jsx", "js"],
  [".ts", "ts"], [".tsx", "ts"],
  [".py", "py"]
]);
const LANG_WASM = { js: "tree-sitter-javascript.wasm", ts: "tree-sitter-typescript.wasm", py: "tree-sitter-python.wasm" };

export function createWasmTreeSitterProvider({ grammarsDir } = {}) {
  const baseDir = grammarsDir || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grammars");
  let initPromise = null;
  const langs = new Map();      // "js"|"ts" -> Language
  let ParserCtor = null;

  async function load() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const mod = await import("web-tree-sitter");
      const Parser = mod.Parser || mod.default;
      await Parser.init();
      const Language = mod.Language || Parser.Language;
      ParserCtor = Parser;
      for (const lang of ["js", "ts", "py"]) {
        const wasm = path.join(baseDir, LANG_WASM[lang]);
        langs.set(lang, await Language.load(wasm));
      }
    })();
    return initPromise;
  }

  function supports(ext) { return EXT_LANG.has(ext); }

  function parseTree(file, source) {
    const language = EXT_LANG.get(extensionOf(file));
    if (!language || !ParserCtor) return { ok: false, language: language || null, tree: null };
    const grammar = langs.get(language);
    if (!grammar) return { ok: false, language, tree: null };
    try {
      const parser = new ParserCtor();
      parser.setLanguage(grammar);
      const tree = parser.parse(String(source ?? ""));
      return { ok: true, language, tree };
    } catch {
      return { ok: false, language, tree: null };
    }
  }

  const queryCache = new Map();
  function compileQuery(language, scm) {
    const grammar = langs.get(language);
    if (!grammar) return null;
    const key = `${language} ${scm}`;
    let q = queryCache.get(key);
    if (!q) { q = grammar.query(scm); queryCache.set(key, q); }
    return q;
  }

  return { name: "wasm-tree-sitter", supports, load, parseTree, compileQuery };
}
