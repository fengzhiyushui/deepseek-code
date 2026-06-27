import path from "node:path";
import { createWasmTreeSitterProvider } from "./wasm-tree-sitter-provider.js";
import { createSymbolCache } from "./symbol-cache.js";
import { indexSymbols } from "./symbol-indexer.js";
import { createLanguageRegistry } from "./language-registry.js";
import { buildDependencyGraph } from "./dependency-graph.js";
import { selectSymbolUnits } from "./symbol-selector.js";
import { resolveModule } from "./module-resolver.js";
import { resolvePythonModule } from "./python-module-resolver.js";
import { readWorkspaceTextFile } from "../../workspace/path-safety.js";

const MAX_FILE_BYTES = 64 * 1024;

export function createSemanticEngine({ root, options = {}, eventBus = null, provider = null } = {}) {
  const cfg = options.semantic || {};
  const enabled = cfg.enabled === true;
  const activeProvider = provider || createWasmTreeSitterProvider();
  const registry = createLanguageRegistry();
  const cache = createSymbolCache({ cacheRoot: path.join(root, ".deepseek-code", "v2", "context") });
  let state = null;          // { byFile, symbolTable, graph, sources }
  let degraded = false;

  async function index(records) {
    if (!enabled || degraded) return;
    try {
      await activeProvider.load();
      const sources = new Map();
      const readFile = async (file) => {
        const t = await readWorkspaceTextFile(root, file, { maxBytes: MAX_FILE_BYTES });
        sources.set(file, t.content);
        return t.content;
      };
      const { byFile, symbolTable, stats } = await indexSymbols({ root, records, provider: activeProvider, registry, cache, readFile });
      // Cache hits skip readFile, so fill sources for any indexed file not yet read —
      // the selector needs current source to slice symbol snippets.
      for (const file of byFile.keys()) {
        if (sources.has(file)) continue;
        try {
          const t = await readWorkspaceTextFile(root, file, { maxBytes: MAX_FILE_BYTES });
          sources.set(file, t.content);
        } catch { /* unreadable -> snippet falls back to empty */ }
      }
      const fileSet = new Set(byFile.keys());
      const importRoots = cfg.importRoots || [];
      for (const pr of byFile.values()) {
        for (const imp of pr.imports) {
          imp.resolved_file = pr.language === "py"
            ? resolvePythonModule({ fromFile: pr.file, spec: imp.source_spec, level: imp.level || 0, fileSet, importRoots })
            : resolveModule({ fromFile: pr.file, spec: imp.source_spec, fileSet });
        }
      }
      const graph = buildDependencyGraph({ byFile, symbolTable, methodHints: cfg.includeMethodHints === true });
      state = { byFile, symbolTable, graph, sources };
      eventBus?.publish?.("context:symbol_indexed", { files_parsed: stats.parsed, symbols: symbolTable.size, reused: stats.reused });
      eventBus?.publish?.("context:graph_built", {
        symbols: symbolTable.size,
        edges: graph.callEdges.length,
        resolved: graph.callEdges.filter((e) => e.confidence === "resolved").length,
        unresolved: graph.callEdges.filter((e) => e.confidence === "unresolved").length
      });
    } catch {
      // provider/grammar unavailable or parse failure -> degrade to file-level context.
      degraded = true;
      state = null;
    }
  }

  function select({ message, pinned, warmed, budget }) {
    if (!enabled || degraded || !state) return null;
    const out = selectSymbolUnits({
      message,
      symbolTable: state.symbolTable,
      byFile: state.byFile,
      graph: state.graph,
      sources: state.sources,
      pinned,
      warmed,
      budget,
      hops: cfg.hops || 2,
      maxSymbols: cfg.maxSymbols || 200
    });
    return out.selected.length ? out : null;
  }

  return { enabled, index, select };
}
