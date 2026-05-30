import {
  extractUnifiedDiff,
  parseUnifiedDiff,
  summarizeDiff
} from "../patch.js";
import { resolveWorkspacePath } from "../workspace/path-safety.js";

export function normalizeUnifiedDiff(input) {
  const raw = typeof input === "string" ? input : "";
  const extracted = extractUnifiedDiff(raw);
  const diff = (extracted || raw).trimEnd();
  if (!diff || (!diff.includes("--- ") && !diff.includes("diff --git "))) {
    throw new Error("unified diff is required");
  }
  return diff;
}

export function parseDiff(input) {
  const diff = normalizeUnifiedDiff(input);
  const patches = parseUnifiedDiff(diff);
  if (!patches.length) {
    throw new Error("unified diff contains no file patches");
  }
  const summary = summarizeDiff(diff);
  return {
    diff,
    patches,
    summary,
    files: summary.map((item) => item.path)
  };
}

export async function assertDiffPathsSafe(projectRoot, patches) {
  if (!projectRoot) throw new Error("projectRoot is required");
  for (const patch of patches) {
    if (patch.oldPath && patch.oldPath !== "/dev/null") {
      await resolveWorkspacePath(projectRoot, patch.oldPath, { mustExist: false });
    }
    if (patch.newPath && patch.newPath !== "/dev/null") {
      await resolveWorkspacePath(projectRoot, patch.newPath, { mustExist: false });
    }
  }
}

export function formatDiffSummary(summary) {
  if (!summary.length) return "No file changes.";
  return summary.map((item) => `${item.status} ${item.path}`).join("\n");
}
