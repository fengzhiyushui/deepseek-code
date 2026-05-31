import { normalizeContextPath } from "./context-unit.js";
import { selectWithinBudget } from "./token-budget.js";

export function detectMentionedPaths(message = "", units = new Map()) {
  const text = String(message || "");
  const paths = [...units.keys()].sort();
  const byBase = new Map();

  for (const p of paths) {
    const base = basename(p);
    byBase.set(base, [...(byBase.get(base) || []), p]);
  }

  const mentioned = new Set();
  for (const p of paths) {
    if (containsPathToken(text, p)) mentioned.add(p);
  }
  for (const [base, candidates] of byBase.entries()) {
    if (candidates.length === 1 && containsPathToken(text, base)) mentioned.add(candidates[0]);
  }
  return mentioned;
}

export function rankContextUnits({
  units = new Map(),
  message = "",
  pinned = new Set(),
  warmed = new Map(),
  classification = {}
} = {}) {
  const mentioned = detectMentionedPaths(message, units);
  const taskType = classification?.task_type || "general";
  const ranked = [];

  for (const unit of units.values()) {
    let priority = unit.priority;
    let reason = unit.reason;
    if (pinned.has(unit.path)) {
      priority = 1;
      reason = "pinned";
    } else if (mentioned.has(unit.path)) {
      priority = 1;
      reason = "mentioned";
    } else if (warmed.has(unit.path)) {
      priority = Math.min(priority, 2);
      reason = warmed.get(unit.path) || "warm";
    } else if ((taskType === "edit" || taskType === "diagnostic") && isCompanion(unit.path)) {
      priority = Math.min(priority, 2);
      reason = unit.reason === "cold" ? "task-companion" : unit.reason;
    }

    if (priority <= 2) ranked.push({ ...unit, priority, reason });
  }

  return ranked.sort(compareUnits);
}

export function selectContextUnits({
  units = new Map(),
  message = "",
  pinned = new Set(),
  warmed = new Map(),
  classification = {},
  budget = 6000
} = {}) {
  const ranked = rankContextUnits({ units, message, pinned, warmed, classification });
  return selectWithinBudget(ranked, budget);
}

function compareUnits(a, b) {
  return (a.priority - b.priority) || stablePrefixRank(a.path) - stablePrefixRank(b.path) || a.path.localeCompare(b.path);
}

function stablePrefixRank(path) {
  const p = normalizeContextPath(path).toLowerCase();
  const order = ["package.json", "readme.md", "environment.yml", "pyproject.toml", "cargo.toml", "go.mod"];
  const index = order.indexOf(p);
  return index === -1 ? 100 : index;
}

function isCompanion(path) {
  const p = normalizeContextPath(path).toLowerCase();
  return p.includes(".test.") || p.includes(".spec.") || p.startsWith("test/") || p.startsWith("tests/") || p.endsWith(".json");
}

function basename(path) {
  return normalizeContextPath(path).split("/").pop();
}

function containsPathToken(text, token) {
  const escaped = escapeRegExp(token);
  return new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}($|[^A-Za-z0-9_./-])`).test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
