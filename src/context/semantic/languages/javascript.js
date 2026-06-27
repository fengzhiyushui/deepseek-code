// JS language definition for the query-extractor.
// The query is intentionally a set of *node anchors*; the per-node extraction
// logic is ported verbatim from js-ts-extractor.js so the ParseResult is
// multiset-identical (shadow parity). The runner owns walk/sort/enclosing/degrade.
import { makeSymbolId } from "../symbol-id.js";

export const jsLanguageDef = {
  language: "js",
  callablePriority: { method: 0, function: 1, variable: 2, class: 3 },
  query: `
    (function_declaration) @def
    (class_declaration) @def
    (method_definition) @def
    (lexical_declaration) @def
    (variable_declaration) @def
    (import_statement) @import
    (export_statement) @export
    (call_expression) @call
  `,
  handleMatch(group, ctx) {
    const file = ctx.file;
    if (group.has("def")) {
      const sym = symbolFromNode(group.get("def")[0], file);
      return sym ? { symbol: sym } : null;
    }
    if (group.has("import")) {
      const imp = importFromStatement(group.get("import")[0], file);
      return imp ? { import: imp } : null;
    }
    if (group.has("export")) {
      const exps = exportFromNode(group.get("export")[0], file);
      return exps ? { exports: exps } : null;
    }
    if (group.has("call")) {
      return handleCall(group.get("call")[0], file);
    }
    return null;
  }
};

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
  const startLine = node.startPosition.row + 1;
  return {
    symbol_id: makeSymbolId({ file, kind, name, startLine }),
    file, name, kind,
    range: { start_line: startLine, end_line: node.endPosition.row + 1 },
    exported: isExported(node),
    _node: node
  };
}

function isExported(node) {
  let p = node.parent;
  while (p) { if (p.type === "export_statement") return true; p = p.parent; }
  return false;
}

function importFromStatement(node, file) {
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
  return { from_file: file, source_spec: spec, resolved_file: null, names, default: def, namespace: ns, kind: "esm", dynamic: false, _node: node };
}

function exportFromNode(node, file) {
  const out = [];
  const source = stringLit(node.childForFieldName("source")); // re-export source, may be null
  const decl = node.childForFieldName("declaration");
  if (decl) {
    const name = nameField(decl, "name");
    if (name) out.push({ file, name, local_name: name, kind: node.text.includes("export default") ? "default" : "named", source_spec: null, _node: decl });
  }
  for (const c of node.namedChildren.filter((x) => x.type === "export_clause")) {
    for (const s of c.namedChildren.filter((x) => x.type === "export_specifier")) {
      const local = s.childForFieldName("name")?.text;
      const exported = s.childForFieldName("alias")?.text || local;
      if (exported) out.push({ file, name: exported, local_name: local, kind: source ? "reexport" : "named", source_spec: source, _node: s });
    }
  }
  return out.length ? out : null;
}

// call_expression handler: ports js-ts-extractor's callFromNode + the require()/import()
// import-edge cases. require("lit") -> cjs import (no call); import("lit") -> esm dynamic
// import AND a dynamic call edge (callee_raw "import"), matching the legacy two-pass walk.
function handleCall(node, file) {
  const fn = node.childForFieldName("function");
  if (!fn) return null;
  if (fn.type === "identifier" && fn.text === "require") {
    const spec = stringLit(node.childForFieldName("arguments")?.namedChild(0));
    if (spec) return { import: { from_file: file, source_spec: spec, resolved_file: null, names: [], default: false, namespace: false, kind: "cjs", dynamic: false, _node: node } };
    return null; // require with non-string arg -> nothing (legacy: importFromNode null + callFromNode skips require)
  }
  if (fn.type === "import") {
    const spec = stringLit(node.childForFieldName("arguments")?.namedChild(0));
    const imp = { from_file: file, source_spec: spec, resolved_file: null, names: [], default: false, namespace: false, kind: "esm", dynamic: true, _node: node };
    const rawCall = { _node: node, callee_raw: fn.text, kind: "dynamic", file, line: node.startPosition.row + 1 };
    return { import: imp, rawCall };
  }
  let kind, callee_raw, memberProperty = null;
  if (fn.type === "identifier") { kind = "identifier"; callee_raw = fn.text; }
  else if (fn.type === "member_expression") {
    kind = "member"; callee_raw = fn.text;
    memberProperty = fn.childForFieldName("property")?.text || null;
  } else { kind = "dynamic"; callee_raw = fn.text; }
  const rawCall = { _node: node, callee_raw, kind, file, line: node.startPosition.row + 1 };
  if (memberProperty) rawCall.member_property = memberProperty;
  return { rawCall };
}

function stringLit(node) {
  if (!node) return null;
  if (node.type === "string") return node.text.replace(/^['"`]|['"`]$/g, "");
  const inner = node.namedChildren?.find((c) => c.type === "string");
  return inner ? inner.text.replace(/^['"`]|['"`]$/g, "") : null;
}
