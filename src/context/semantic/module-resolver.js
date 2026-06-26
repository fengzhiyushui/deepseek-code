import path from "node:path";

const EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

export function resolveModule({ fromFile, spec, fileSet }) {
  if (typeof spec !== "string" || !(spec.startsWith("./") || spec.startsWith("../"))) return null;
  const fromDir = path.posix.dirname(toPosix(fromFile));
  const base = path.posix.normalize(path.posix.join(fromDir, spec)).replace(/^\.\//, "");
  if (fileSet.has(base)) return base;
  for (const ext of EXTS) if (fileSet.has(base + ext)) return base + ext;
  for (const ext of EXTS) if (fileSet.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

function toPosix(p) { return String(p).replace(/\\/g, "/"); }
