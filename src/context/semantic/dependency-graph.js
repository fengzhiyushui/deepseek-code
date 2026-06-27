export function buildDependencyGraph({ byFile, symbolTable, methodHints = false }) {
  const callEdges = [];
  const outAdj = new Map(); // symbol_id -> Map(callee symbol_id -> confidence)
  const inAdj = new Map();  // symbol_id -> Map(caller symbol_id -> confidence)
  const nameIndex = methodHints ? buildNameIndex(symbolTable) : null;

  for (const pr of byFile.values()) {
    const localByName = new Map(pr.symbols.map((s) => [s.name, s]));
    const importBinding = buildImportBinding(pr, byFile);
    for (const rc of pr.calls) {
      const edge = resolveCall(rc, localByName, importBinding, nameIndex, methodHints);
      callEdges.push(edge);
      if (edge.callee_symbol_id && (edge.confidence === "resolved" || edge.confidence === "probable")) {
        addAdj(outAdj, edge.caller_symbol_id, edge.callee_symbol_id, edge.confidence);
        addAdj(inAdj, edge.callee_symbol_id, edge.caller_symbol_id, edge.confidence);
      }
    }
  }

  function neighbors(symbolId, { hops = 1, direction = "out" } = {}) {
    const result = new Map(); // id -> strongest confidence
    const maps = direction === "in" ? [inAdj] : direction === "both" ? [outAdj, inAdj] : [outAdj];
    let frontier = new Set([symbolId]);
    for (let h = 0; h < hops; h += 1) {
      const next = new Set();
      for (const id of frontier) for (const m of maps) {
        const adj = m.get(id);
        if (!adj) continue;
        for (const [n, conf] of adj) {
          const prev = result.get(n);
          if (prev === undefined) { result.set(n, conf); next.add(n); }
          else if (prev === "probable" && conf === "resolved") { result.set(n, "resolved"); }
        }
      }
      frontier = next;
      if (!frontier.size) break;
    }
    return result;
  }

  return { callEdges, neighbors };
}

function buildNameIndex(symbolTable) {
  const CALLABLE = new Set(["function", "method", "variable"]); // variable = named arrow/function only
  const index = new Map();
  for (const sym of symbolTable.values()) {
    if (!CALLABLE.has(sym.kind)) continue; // exclude class etc.
    if (!index.has(sym.name)) index.set(sym.name, []);
    index.get(sym.name).push(sym.symbol_id);
  }
  return index;
}

function buildImportBinding(pr, byFile) {
  // local import name -> resolved exported symbol_id (best-effort)
  const binding = new Map();
  for (const imp of pr.imports) {
    if (!imp.resolved_file) continue;
    const target = byFile.get(imp.resolved_file);
    if (!target) continue;
    for (const { imported, local } of imp.names) {
      const exp = target.exports.find((e) => e.name === imported);
      const localName = exp ? exp.local_name : imported;
      const sym = target.symbols.find((s) => s.name === localName && s.exported) || target.symbols.find((s) => s.name === localName);
      if (sym) binding.set(local, sym.symbol_id);
    }
  }
  return binding;
}

function resolveCall(rc, localByName, importBinding, nameIndex, methodHints) {
  const base = { caller_symbol_id: rc.caller_symbol_id, callee_raw: rc.callee_raw, file: rc.file, line: rc.line, callee_symbol_id: null };
  if (rc.kind === "identifier") {
    const local = localByName.get(rc.callee_raw);
    if (local) return { ...base, callee_symbol_id: local.symbol_id, confidence: "resolved", reason: "direct-local-call" };
    const bound = importBinding.get(rc.callee_raw);
    if (bound) return { ...base, callee_symbol_id: bound, confidence: "resolved", reason: "import-binding" };
    return { ...base, confidence: "unresolved", reason: "dynamic-call" };
  }
  if (rc.kind === "member") {
    if (methodHints && nameIndex && rc.member_property) {
      const matches = nameIndex.get(rc.member_property);
      if (matches && matches.length === 1) {
        return { ...base, callee_symbol_id: matches[0], confidence: "probable", reason: "member-call" };
      }
    }
    return { ...base, confidence: "unresolved", reason: "member-call" };
  }
  return { ...base, confidence: "unresolved", reason: "dynamic-call" };
}

function addAdj(map, from, to, confidence) {
  if (!map.has(from)) map.set(from, new Map());
  const adj = map.get(from);
  const prev = adj.get(to);
  if (prev === undefined || (prev === "probable" && confidence === "resolved")) adj.set(to, confidence);
}
