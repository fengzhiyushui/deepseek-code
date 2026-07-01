// Filter a nested file tree (buildTree output) by a case-insensitive name substring.
// A directory survives if it (or any descendant) matches. Pure — node:test-covered.
export function filterTree(tree, q) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return tree || [];
  function walk(nodes) {
    const out = [];
    for (const n of nodes || []) {
      if (n.type === "dir") {
        const kids = walk(n.children || []);
        if (kids.length || n.name.toLowerCase().includes(query)) out.push({ ...n, children: kids });
      } else if (n.name.toLowerCase().includes(query)) {
        out.push(n);
      }
    }
    return out;
  }
  return walk(tree || []);
}
