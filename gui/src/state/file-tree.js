// Build a nested folder tree from a flat list of posix relative file paths.
// Pure — node:test-covered. Dirs sort before files; each group alphabetical.
export function buildTree(paths) {
  const root = new Map();
  for (const p of paths || []) {
    const parts = String(p).split("/").filter(Boolean);
    let level = root;
    let acc = "";
    parts.forEach((part, i) => {
      acc = acc ? acc + "/" + part : part;
      const isFile = i === parts.length - 1;
      if (!level.has(part)) {
        level.set(part, { name: part, path: acc, type: isFile ? "file" : "dir", children: isFile ? null : new Map() });
      }
      const node = level.get(part);
      if (!isFile) level = node.children;
    });
  }
  return toArray(root);
}

function toArray(level) {
  const nodes = [...level.values()];
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return nodes.map((n) =>
    n.type === "dir"
      ? { name: n.name, path: n.path, type: "dir", children: toArray(n.children) }
      : { name: n.name, path: n.path, type: "file" }
  );
}
