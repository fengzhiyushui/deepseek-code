// Generic tree-sitter query runner: turns query matches into a ParseResult.
// Language-specific behavior lives in a `languageDef` (query string + handleMatch);
// this runner owns match grouping, canonical byte-offset sorting, enclosing-symbol
// attribution for calls, and per-file degrade (ok:false). ParseResult contract is
// identical to js-ts-extractor — downstream (graph/selector) is language-agnostic.

const EMPTY = (file, language = null) => ({ file, language, symbols: [], imports: [], exports: [], calls: [], ok: false });

export function extractParseResult({ file, source, provider, registry }) {
  const parsed = provider?.parseTree?.(file, source);
  if (!parsed || !parsed.ok || !parsed.tree) return EMPTY(file, parsed?.language ?? null);
  const def = registry?.get?.(parsed.language);
  if (!def) return EMPTY(file, parsed.language);
  const query = provider.compileQuery(parsed.language, def.query);
  if (!query) return EMPTY(file, parsed.language);
  try {
    return extractWithDef({ file, source, tree: parsed.tree, query, def });
  } catch {
    return EMPTY(file, parsed.language);   // degrade: this file only, never crash
  }
}

export function extractWithDef({ file, source, tree, query, def }) {
  const symbols = [], imports = [], exports = [], rawCalls = [];
  for (const match of query.matches(tree.rootNode)) {
    const group = groupCaptures(match);
    const el = def.handleMatch(group, { file, source });
    if (!el) continue;
    if (el.symbol) symbols.push(el.symbol);
    if (el.import) imports.push(el.import);
    if (el.imports) imports.push(...el.imports);
    if (el.exports) exports.push(...el.exports);
    if (el.rawCall) rawCalls.push(el.rawCall);
  }
  const calls = rawCalls.map((rc) => {
    const call = {
      caller_symbol_id: enclosingSymbolId(rc._node, symbols, def),
      callee_raw: rc.callee_raw, kind: rc.kind, file: rc.file, line: rc.line
    };
    if (rc.member_property) call.member_property = rc.member_property;
    return call;
  });
  sortByNode(symbols); sortByNode(imports); sortByNode(exports);
  calls.sort(byCallKey);
  for (const s of symbols) delete s._node;
  for (const i of imports) delete i._node;
  for (const e of exports) delete e._node;
  return { file, language: def.language, symbols, imports, exports, calls, ok: true };
}

function groupCaptures(match) {
  const g = new Map();
  for (const c of match.captures) {
    if (!g.has(c.name)) g.set(c.name, []);
    g.get(c.name).push(c.node);
  }
  return g;
}

// enclosing symbol = the symbol whose byte range contains the call and is smallest;
// ties broken by callablePriority (method>function>variable>class) then symbol_id.
function enclosingSymbolId(callNode, symbols, def) {
  const cs = callNode.startIndex, ce = callNode.endIndex;
  let best = null, bestSpan = Infinity, bestPri = 9;
  for (const s of symbols) {
    const n = s._node; if (!n) continue;
    if (n.startIndex <= cs && n.endIndex >= ce) {
      const span = n.endIndex - n.startIndex;
      const pri = def.callablePriority?.[s.kind] ?? 9;
      if (span < bestSpan
        || (span === bestSpan && pri < bestPri)
        || (span === bestSpan && pri === bestPri && best && s.symbol_id < best.symbol_id)) {
        best = s; bestSpan = span; bestPri = pri;
      }
    }
  }
  return best ? best.symbol_id : null;
}

function nodeKey(x) {
  const n = x._node;
  return [n.startIndex, n.endIndex, n.startPosition.row + 1, n.startPosition.column, x.kind || "", x.name || x.source_spec || ""];
}
function sortByNode(arr) {
  arr.sort((a, b) => cmpTuple(nodeKey(a), nodeKey(b)));
}
function byCallKey(a, b) {
  return cmpTuple([a.file, a.line, a.callee_raw, a.kind], [b.file, b.line, b.callee_raw, b.kind]);
}
function cmpTuple(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}
