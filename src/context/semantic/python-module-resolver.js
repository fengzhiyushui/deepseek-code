// Best-effort static Python module resolution.
// Resolves a dotted import specifier (with relative `level` = leading-dot count)
// to a workspace-relative .py / package __init__.py, or null (external / unresolvable).
// Effective roots for absolute imports = ["" (project root), ...importRoots] (appended,
// first hit wins). Module file wins over package __init__; a directory without an
// __init__.py (namespace package) yields no concrete target -> null.
import path from "node:path";

export function resolvePythonModule({ fromFile, spec, level = 0, fileSet, importRoots = [] }) {
  const parts = String(spec || "").split(".").filter(Boolean);
  if (level > 0) {
    // relative: climb (level-1) dirs from fromFile's directory, then descend `parts`
    let dir = path.posix.dirname(toPosix(fromFile));
    for (let i = 1; i < level; i += 1) dir = path.posix.dirname(dir);
    const base = [dir === "." ? "" : dir, ...parts].filter(Boolean).join("/");
    return resolveBase(base, fileSet);
  }
  // absolute: try each effective root ("" = project root, then importRoots); first hit wins
  for (const root of ["", ...importRoots]) {
    const base = [root, ...parts].filter(Boolean).join("/");
    const hit = resolveBase(base, fileSet);
    if (hit) return hit;
  }
  return null;
}

function resolveBase(base, fileSet) {
  if (!base) return null;
  if (fileSet.has(`${base}.py`)) return `${base}.py`;            // module file wins
  if (fileSet.has(`${base}/__init__.py`)) return `${base}/__init__.py`; // package
  return null; // namespace package w/o __init__ -> no concrete target -> external
}

function toPosix(p) { return String(p).replace(/\\/g, "/"); }
