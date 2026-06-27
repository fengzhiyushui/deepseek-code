const CASE_FOLD = process.platform === "win32";

export function normalizePath(p) {
  let s = String(p || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
  s = s.replace(/^\/+/, "");
  if (CASE_FOLD) s = s.toLowerCase();
  return s;
}

function asDirPrefix(p) { return p.endsWith("/") ? p : `${p}/`; }

function containsOrEquals(a, b) {
  // does a contain or equal b? (either may be an explicit dir prefix)
  if (a === b) return true;
  if (a.endsWith("/")) return b.startsWith(a);
  return b.startsWith(asDirPrefix(a)) || a.startsWith(asDirPrefix(b));
}

export function overlaps(setA, setB) {
  const A = [...setA].map(normalizePath);
  const B = [...setB].map(normalizePath);
  for (const a of A) for (const b of B) if (containsOrEquals(a, b)) return true;
  return false;
}

export function withinScope(actualPaths, declaredFiles) {
  const declared = [...declaredFiles].map(normalizePath);
  const out = [];
  for (const raw of actualPaths) {
    const a = normalizePath(raw);
    const inScope = declared.some((d) => d === a || a.startsWith(asDirPrefix(d)));
    if (!inScope) out.push(a);
  }
  return out;
}
