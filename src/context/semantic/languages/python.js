// Python language definition for the query-extractor.
// Node anchors + imperative handlers (mirrors the JS def's shape). Module-level
// function/class are exported:true; methods (function under class body) are
// exported:false; nested functions are exported:false. Python has no export
// statements -> exports always []. Imports carry a `level` (relative-dot count)
// consumed by python-module-resolver; cross-file binding falls back to `exported`
// symbols in the resolved module.
import { makeSymbolId } from "../symbol-id.js";

export const pythonLanguageDef = {
  language: "py",
  callablePriority: { method: 0, function: 1, variable: 2, class: 3 },
  query: `
    (function_definition) @def.fn
    (class_definition) @def.cls
    (import_statement) @import
    (import_from_statement) @importfrom
    (call) @call
  `,
  handleMatch(group, ctx) {
    const file = ctx.file;
    if (group.has("def.fn")) {
      const node = group.get("def.fn")[0];
      const name = node.childForFieldName("name")?.text;
      if (!name) return null;
      const { kind, exported } = classifyFn(node);
      return { symbol: makeSymbol(file, name, kind, exported, node) };
    }
    if (group.has("def.cls")) {
      const node = group.get("def.cls")[0];
      const name = node.childForFieldName("name")?.text;
      if (!name) return null;
      return { symbol: makeSymbol(file, name, "class", node.parent?.type === "module", node) };
    }
    if (group.has("import")) {
      return { imports: importsFromImportStatement(group.get("import")[0], file) };
    }
    if (group.has("importfrom")) {
      const imp = importFromFromStatement(group.get("importfrom")[0], file);
      return imp ? { import: imp } : null;
    }
    if (group.has("call")) {
      return { rawCall: callFromNode(group.get("call")[0], file) };
    }
    return null;
  }
};

function makeSymbol(file, name, kind, exported, node) {
  const startLine = node.startPosition.row + 1;
  return {
    symbol_id: makeSymbolId({ file, kind, name, startLine }),
    file, name, kind,
    range: { start_line: startLine, end_line: node.endPosition.row + 1 },
    exported: exported === true,
    _node: node
  };
}

function classifyFn(node) {
  const parent = node.parent;
  if (parent?.type === "module") return { kind: "function", exported: true };
  // parent is a block: method if the block belongs to a class, else nested function
  if (parent?.parent?.type === "class_definition") return { kind: "method", exported: false };
  return { kind: "function", exported: false };
}

function importsFromImportStatement(node, file) {
  // `import a` / `import a.b as c` / `import a, b` -> one Import per module
  const out = [];
  for (const c of node.namedChildren) {
    if (c.type === "dotted_name") out.push(pyImport(file, c.text, 0, [], c));
    else if (c.type === "aliased_import") {
      const nm = c.childForFieldName("name")?.text;
      if (nm) out.push(pyImport(file, nm, 0, [], c));
    }
  }
  return out;
}

function importFromFromStatement(node, file) {
  // `from <module> import <names>` ; module may be relative (level>0) or absolute
  const moduleNode = node.childForFieldName("module_name");
  const { level, spec } = parseModuleName(moduleNode);
  const names = [];
  for (const c of node.namedChildren) {
    if (sameNode(c, moduleNode) || c.type === "wildcard_import") continue;
    if (c.type === "dotted_name") names.push({ imported: c.text, local: c.text });
    else if (c.type === "aliased_import") {
      const nm = c.childForFieldName("name")?.text;
      const alias = c.childForFieldName("alias")?.text;
      if (nm) names.push({ imported: nm, local: alias || nm });
    }
  }
  return pyImport(file, spec, level, names, node);
}

function parseModuleName(moduleNode) {
  if (!moduleNode) return { level: 0, spec: "" };
  if (moduleNode.type === "relative_import") {
    const prefix = moduleNode.namedChildren.find((c) => c.type === "import_prefix");
    const dotted = moduleNode.namedChildren.find((c) => c.type === "dotted_name");
    const level = prefix ? (prefix.text.match(/\./g) || []).length : 0;
    return { level, spec: dotted ? dotted.text : "" };
  }
  return { level: 0, spec: moduleNode.text };
}

function pyImport(file, spec, level, names, node) {
  return { from_file: file, source_spec: spec, resolved_file: null, names, default: false, namespace: false, kind: "py", dynamic: false, level, _node: node };
}

function callFromNode(node, file) {
  const fn = node.childForFieldName("function");
  const line = node.startPosition.row + 1;
  let kind, callee_raw, memberProperty = null;
  if (fn?.type === "identifier") { kind = "identifier"; callee_raw = fn.text; }
  else if (fn?.type === "attribute") {
    kind = "member"; callee_raw = fn.text;
    memberProperty = fn.childForFieldName("attribute")?.text || null;
  } else { kind = "dynamic"; callee_raw = fn?.text ?? ""; }
  const rawCall = { _node: node, callee_raw, kind, file, line };
  if (memberProperty) rawCall.member_property = memberProperty;
  return rawCall;
}

function sameNode(a, b) {
  return !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;
}
