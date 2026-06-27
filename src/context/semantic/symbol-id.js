// Stable symbol identity for the semantic layer.
// symbol_id = `${workspaceRelativePath}#${kind}:${nameOrLocalName}:${start_line}`
// Stable across pure body edits; shifts when start_line moves. Single source of truth
// shared by every language definition (the graph keys on it; do not change the format).
export function makeSymbolId({ file, kind, name, startLine }) {
  return `${file}#${kind}:${name}:${startLine}`;
}
