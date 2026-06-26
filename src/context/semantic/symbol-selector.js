import { selectWithinBudget } from "../token-budget.js";
import { createSymbolUnit } from "./symbol-unit.js";

export function selectSymbolUnits({ message = "", symbolTable, byFile, graph, sources, pinned = new Set(), warmed = new Map(), budget = 6000, hops = 2, maxSymbols = 200 }) {
  const text = String(message || "");
  const priorityById = new Map();   // symbol_id -> best priority (lower = better)
  const reasonById = new Map();

  const seed = (id, reason) => {
    if (!symbolTable.has(id)) return;
    if (!priorityById.has(id) || priorityById.get(id) > 1) { priorityById.set(id, 1); reasonById.set(id, reason); }
  };

  // Seeds: symbol name mentioned in message, or symbol in pinned/warmed file.
  for (const sym of symbolTable.values()) {
    if (mentionsName(text, sym.name)) seed(sym.symbol_id, "mentioned");
    else if (pinned.has(sym.file)) seed(sym.symbol_id, "pinned");
    else if (warmed.has(sym.file)) seed(sym.symbol_id, "warm");
  }

  // Expand neighbors (priority 2 by hop).
  for (const id of [...priorityById.keys()]) {
    for (const n of graph.neighbors(id, { hops, direction: "out" })) {
      if (!priorityById.has(n)) { priorityById.set(n, 2); reasonById.set(n, "graph-neighbor"); }
    }
  }

  // Build candidate units, ranked by priority then id (stable), capped at maxSymbols.
  const candidates = [...priorityById.keys()]
    .map((id) => symbolTable.get(id))
    .filter(Boolean)
    .sort((a, b) => (priorityById.get(a.symbol_id) - priorityById.get(b.symbol_id)) || a.symbol_id.localeCompare(b.symbol_id))
    .slice(0, maxSymbols)
    .map((sym) => createSymbolUnit({
      symbol: sym,
      source: sources.get(sym.file) || "",
      priority: priorityById.get(sym.symbol_id),
      reason: reasonById.get(sym.symbol_id)
    }));

  const picked = selectWithinBudget(candidates, budget);
  return { selected: picked.selected, budget: picked.budget };
}

function mentionsName(text, name) {
  if (!name || name.length < 2) return false;
  return new RegExp(`(^|[^A-Za-z0-9_$])${escapeRe(name)}($|[^A-Za-z0-9_$])`).test(text);
}
function escapeRe(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
