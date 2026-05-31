import { createHash } from "node:crypto";
import { nowIso } from "../shared/time.js";

const STABLE_MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "environment.yml"
]);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml"
]);

export function createContextUnit({
  path,
  content,
  reason = null,
  priority = null,
  maxSnippetBytes = 4000,
  now = nowIso()
} = {}) {
  if (!path || typeof path !== "string") throw new Error("path is required");
  if (typeof content !== "string") throw new Error("content must be a string");

  const base = priorityForPath(path);
  const normalizedPath = normalizeContextPath(path);
  const hash = `sha256:${hashText(content)}`;
  const snippet = clipSnippet(content, maxSnippetBytes);

  return {
    id: `ctx_${hashText(`${normalizedPath}\0${content}`).slice(0, 12)}`,
    type: "file",
    path: normalizedPath,
    hash,
    bytes: Buffer.byteLength(content),
    token_count: estimateTokens(snippet),
    priority: priority ?? base.priority,
    reason: reason || base.reason,
    snippet,
    updated_at: now
  };
}

export function priorityForPath(inputPath) {
  const p = normalizeContextPath(inputPath);
  const lower = p.toLowerCase();
  const base = lower.split("/").pop();
  const ext = extensionOf(lower);

  if (STABLE_MANIFESTS.has(base)) return { priority: 0, reason: "project-manifest" };
  if (base === "readme.md") return { priority: 0, reason: "project-doc" };
  if (lower.includes(".test.") || lower.includes(".spec.") || lower.startsWith("test/") || lower.startsWith("tests/")) {
    return { priority: 2, reason: "test" };
  }
  if (SOURCE_EXTENSIONS.has(ext) && (lower.startsWith("src/") || lower.startsWith("bin/") || lower.startsWith("lib/"))) {
    return { priority: 2, reason: "source" };
  }
  if ([".json", ".yml", ".yaml", ".toml"].includes(ext)) return { priority: 2, reason: "config" };
  return { priority: 3, reason: "cold" };
}

export function estimateTokens(text) {
  const bytes = Buffer.byteLength(String(text || ""));
  return bytes === 0 ? 0 : Math.ceil(bytes / 4);
}

export function clipSnippet(text, maxChars = 4000) {
  const value = String(text || "");
  if (maxChars <= 0) return "";
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

export function createContextRecord({
  path,
  content,
  stat = {},
  reason = null,
  priority = null,
  maxSnippetBytes = 4000,
  now = nowIso(),
  policyVersion = "v2-10"
} = {}) {
  const unit = createContextUnit({ path, content, reason, priority, maxSnippetBytes, now });
  const { snippet, ...record } = unit;
  return {
    ...record,
    mtime_ms: stat.mtimeMs ?? stat.mtime_ms ?? 0,
    size: stat.size ?? record.bytes,
    indexed_at: now,
    policy_version: policyVersion
  };
}

export function hydrateContextUnit(record, content, { maxSnippetBytes = 4000, now = nowIso() } = {}) {
  return {
    ...record,
    bytes: Buffer.byteLength(content),
    token_count: estimateTokens(clipSnippet(content, maxSnippetBytes)),
    snippet: clipSnippet(content, maxSnippetBytes),
    updated_at: now
  };
}

export function normalizeContextPath(inputPath) {
  return String(inputPath || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function hashText(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function extensionOf(inputPath) {
  const last = inputPath.split("/").pop() || "";
  const index = last.lastIndexOf(".");
  return index >= 0 ? last.slice(index) : "";
}
