import { createHash } from "node:crypto";
import { estimateTokens, clipSnippet } from "../context-unit.js";

export function createSymbolUnit({ symbol, source, priority = 2, reason = "symbol", maxSnippetBytes = 4000 }) {
  const lines = String(source ?? "").split("\n");
  const slice = lines.slice(symbol.range.start_line - 1, symbol.range.end_line).join("\n");
  const snippet = clipSnippet(slice, maxSnippetBytes);
  return {
    id: `sym_${createHash("sha256").update(symbol.symbol_id).digest("hex").slice(0, 12)}`,
    type: "symbol",
    path: symbol.file,
    symbol_id: symbol.symbol_id,
    symbol_kind: symbol.kind,
    name: symbol.name,
    defined_in: { ...symbol.range },
    hash: `sha256:${createHash("sha256").update(snippet).digest("hex")}`,
    token_count: estimateTokens(snippet),
    priority,
    reason,
    snippet
  };
}
