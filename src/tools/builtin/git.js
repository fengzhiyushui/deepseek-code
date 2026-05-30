import { createShellTool } from "./shell.js";

const GIT_READ_OPS = {
  status: ["git", "status", "--short"],
  diff: ["git", "diff", "--"],
  log: ["git", "log", "--oneline", "-20"],
  show: ["git", "show", "--stat", "--oneline", "HEAD"]
};

export function createGitTool() {
  return {
    name: "git",
    description: "Run safe git read operations",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: {
      op: { type: "string", enum: Object.keys(GIT_READ_OPS) },
      argv: { type: "array", required: false, internal: true }
    },
    normalizeParams,
    execute: async (params, context) => {
      const normalized = normalizeParams(params);
      return createShellTool().execute({ argv: normalized.argv, cwd: "." }, context);
    }
  };
}

function normalizeParams(params) {
  const argv = GIT_READ_OPS[params.op];
  if (!argv) throw new Error(`unsupported git read op: ${params.op}`);
  return { ...params, argv };
}
