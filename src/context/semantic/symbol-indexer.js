import { extractParseResult as legacyExtract } from "./js-ts-extractor.js";
import { extractParseResult as queryExtract } from "./query-extractor.js";

export async function indexSymbols({ root, records, provider, registry, cache, readFile, useLegacyExtractor = false }) {
  const byFile = new Map();
  const symbolTable = new Map();
  const stats = { parsed: 0, reused: 0, skipped: 0, failed: 0 };
  const files = [...records.values()].map((r) => r.path);

  for (const record of records.values()) {
    const file = record.path;
    if (!provider.supports(extOf(file))) { stats.skipped += 1; continue; }
    let parseResult = await cache.get(file, record.hash);
    if (parseResult) {
      stats.reused += 1;
    } else {
      let source;
      try { source = await readFile(file); } catch { stats.failed += 1; continue; }
      parseResult = useLegacyExtractor
        ? legacyExtract({ file, source, parseTree: (f, s) => provider.parseTree(f, s) })
        : queryExtract({ file, source, provider, registry });
      if (!parseResult.ok) { stats.failed += 1; continue; }
      await cache.set(file, record.hash, parseResult);
      stats.parsed += 1;
    }
    byFile.set(file, parseResult);
    for (const sym of parseResult.symbols) symbolTable.set(sym.symbol_id, sym);
  }
  await cache.pruneMissing(files);
  return { byFile, symbolTable, stats };
}

function extOf(p) { const last = p.split(/[\\/]/).pop() || ""; const i = last.lastIndexOf("."); return i >= 0 ? last.slice(i).toLowerCase() : ""; }
