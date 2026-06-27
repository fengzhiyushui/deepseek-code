export function makeSymbolId({ file, kind, name, startLine }) {
  return `${file}#${kind}:${name}:${startLine}`;
}

const EMPTY = (file, language = null) => ({ file, language, symbols: [], imports: [], exports: [], calls: [], ok: false });

export function extractParseResult({ file, source, parseTree }) {
  const parsed = parseTree(file, source);
  if (!parsed || !parsed.ok || !parsed.tree) return EMPTY(file, parsed?.language ?? null);

  const symbols = [];
  const imports = [];
  const exports = [];
  const calls = [];
  const root = parsed.tree.rootNode;

  // First pass: collect declared symbols with line ranges.
  walk(root, (node) => {
    const sym = symbolFromNode(node, file);
    if (sym) symbols.push(sym);
  });

  // Second pass: imports/exports/calls (calls attributed to enclosing symbol).
  walk(root, (node) => {
    const imp = importFromNode(node, file);
    if (imp) imports.push(imp);
    const exp = exportFromNode(node, file);
    if (exp) exports.push(...exp);
    const call = callFromNode(node, file, symbols);
    if (call) calls.push(call);
  });

  return { file, language: parsed.language, symbols, imports, exports, calls, ok: true };
}

function walk(node, visit) {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i += 1) walk(node.namedChild(i), visit);
}

function lineOf(node) { return node.startPosition.row + 1; }
function endLineOf(node) { return node.endPosition.row + 1; }
function nameField(node, field) { const n = node.childForFieldName(field); return n ? n.text : null; }

function symbolFromNode(node, file) {
  let kind = null;
  let name = null;
  if (node.type === "function_declaration") { kind = "function"; name = nameField(node, "name"); }
  else if (node.type === "class_declaration") { kind = "class"; name = nameField(node, "name"); }
  else if (node.type === "method_definition") { kind = "method"; name = nameField(node, "name"); }
  else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    const decl = node.namedChildren.find((c) => c.type === "variable_declarator");
    const value = decl?.childForFieldName("value");
    if (decl && value && (value.type === "arrow_function" || value.type === "function" || value.type === "function_expression")) {
      kind = "variable"; name = decl.childForFieldName("name")?.text || null;
    }
  }
  if (!kind || !name) return null;
  const startLine = lineOf(node);
  return {
    symbol_id: makeSymbolId({ file, kind, name, startLine }),
    file, name, kind,
    range: { start_line: startLine, end_line: endLineOf(node) },
    exported: isExported(node)
  };
}

function isExported(node) {
  let p = node.parent;
  while (p) { if (p.type === "export_statement") return true; p = p.parent; }
  return false;
}

function importFromNode(node, file) {
  if (node.type === "import_statement") {
    const spec = stringLit(node.childForFieldName("source"));
    const clause = node.namedChildren.find((c) => c.type === "import_clause");
    const names = [];
    let def = false, ns = false;
    if (clause) {
      for (const c of clause.namedChildren) {
        if (c.type === "identifier") def = true;
        else if (c.type === "namespace_import") ns = true;
        else if (c.type === "named_imports") {
          for (const s of c.namedChildren.filter((x) => x.type === "import_specifier")) {
            const imported = s.childForFieldName("name")?.text;
            const local = s.childForFieldName("alias")?.text || imported;
            if (imported) names.push({ imported, local });
          }
        }
      }
    }
    return { from_file: file, source_spec: spec, resolved_file: null, names, default: def, namespace: ns, kind: "esm", dynamic: false };
  }
  // CJS require("lit") + dynamic import()
  if (node.type === "call_expression") {
    const fn = node.childForFieldName("function");
    if (fn?.type === "identifier" && fn.text === "require") {
      const spec = stringLit(node.childForFieldName("arguments")?.namedChild(0));
      if (spec) return { from_file: file, source_spec: spec, resolved_file: null, names: [], default: false, namespace: false, kind: "cjs", dynamic: false };
    }
    if (fn?.type === "import") {
      const spec = stringLit(node.childForFieldName("arguments")?.namedChild(0));
      return { from_file: file, source_spec: spec, resolved_file: null, names: [], default: false, namespace: false, kind: "esm", dynamic: true };
    }
  }
  return null;
}

function exportFromNode(node, file) {
  if (node.type !== "export_statement") return null;
  const out = [];
  const source = stringLit(node.childForFieldName("source")); // re-export source, may be null
  const decl = node.childForFieldName("declaration");
  if (decl) {
    const name = nameField(decl, "name");
    if (name) out.push({ file, name, local_name: name, kind: node.text.includes("export default") ? "default" : "named", source_spec: null });
  }
  for (const c of node.namedChildren.filter((x) => x.type === "export_clause")) {
    for (const s of c.namedChildren.filter((x) => x.type === "export_specifier")) {
      const local = s.childForFieldName("name")?.text;
      const exported = s.childForFieldName("alias")?.text || local;
      if (exported) out.push({ file, name: exported, local_name: local, kind: source ? "reexport" : "named", source_spec: source });
    }
  }
  return out.length ? out : null;
}

function callFromNode(node, file, symbols) {
  if (node.type !== "call_expression") return null;
  const fn = node.childForFieldName("function");
  if (!fn) return null;
  if (fn.type === "identifier" && fn.text === "require") return null; // handled as import
  let kind, callee_raw, memberProperty = null;
  if (fn.type === "identifier") { kind = "identifier"; callee_raw = fn.text; }
  else if (fn.type === "member_expression") {
    kind = "member"; callee_raw = fn.text;
    memberProperty = fn.childForFieldName("property")?.text || null;
  } else { kind = "dynamic"; callee_raw = fn.text; }
  const line = lineOf(node);
  const call = { caller_symbol_id: enclosingSymbolId(line, symbols), callee_raw, kind, file, line };
  if (memberProperty) call.member_property = memberProperty;
  return call;
}

function enclosingSymbolId(line, symbols) {
  let best = null;
  for (const s of symbols) {
    if (line >= s.range.start_line && line <= s.range.end_line) {
      if (!best || (s.range.end_line - s.range.start_line) < (best.range.end_line - best.range.start_line)) best = s;
    }
  }
  return best ? best.symbol_id : null;
}

function stringLit(node) {
  if (!node) return null;
  if (node.type === "string") return node.text.replace(/^['"`]|['"`]$/g, "");
  const inner = node.namedChildren?.find((c) => c.type === "string");
  return inner ? inner.text.replace(/^['"`]|['"`]$/g, "") : null;
}
