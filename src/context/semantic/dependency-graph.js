export function buildDependencyGraph({ byFile, symbolTable }) {
  const callEdges = [];
  const outAdj = new Map(); // symbol_id -> Set(callee symbol_id)
  const inAdj = new Map();  // symbol_id -> Set(caller symbol_id)

  for (const pr of byFile.values()) {
    const localByName = new Map(pr.symbols.map((s) => [s.name, s]));
    const importBinding = buildImportBinding(pr, byFile);
    for (const rc of pr.calls) {
      const edge = resolveCall(rc, localByName, importBinding);
      callEdges.push(edge);
      if (edge.callee_symbol_id && edge.confidence === "resolved") {
        addAdj(outAdj, edge.caller_symbol_id, edge.callee_symbol_id);
        addAdj(inAdj, edge.callee_symbol_id, edge.caller_symbol_id);
      }
    }
  }

  function neighbors(symbolId, { hops = 1, direction = "out" } = {}) {
    const result = new Set();
    const maps = direction === "in" ? [inAdj] : direction === "both" ? [outAdj, inAdj] : [outAdj];
    let frontier = new Set([symbolId]);
    for (let h = 0; h < hops; h += 1) {
      const next = new Set();
      for (const id of frontier) for (const m of maps) for (const n of m.get(id) || []) {
        if (!result.has(n)) { result.add(n); next.add(n); }
      }
      frontier = next;
      if (!frontier.size) break;
    }
    return result;
  }

  return { callEdges, neighbors };
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

function resolveCall(rc, localByName, importBinding) {
  const base = { caller_symbol_id: rc.caller_symbol_id, callee_raw: rc.callee_raw, file: rc.file, line: rc.line, callee_symbol_id: null };
  if (rc.kind === "identifier") {
    const local = localByName.get(rc.callee_raw);
    if (local) return { ...base, callee_symbol_id: local.symbol_id, confidence: "resolved", reason: "direct-local-call" };
    const bound = importBinding.get(rc.callee_raw);
    if (bound) return { ...base, callee_symbol_id: bound, confidence: "resolved", reason: "import-binding" };
    return { ...base, confidence: "unresolved", reason: "dynamic-call" };
  }
  if (rc.kind === "member") return { ...base, confidence: "unresolved", reason: "member-call" };
  return { ...base, confidence: "unresolved", reason: "dynamic-call" };
}

function addAdj(map, from, to) { if (!map.has(from)) map.set(from, new Set()); map.get(from).add(to); }
