import { walkWorkspaceFiles } from "../../workspace/path-safety.js";

export function createGlobTool() {
  return {
    name: "glob",
    description: "Find workspace files matching a glob pattern",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: { pattern: { type: "string", description: "Glob pattern such as src/**/*.js" } },
    execute: async (params, context) => {
      const files = await walkWorkspaceFiles(context.projectRoot, ".");
      const regex = globToRegex(params.pattern);
      const matched = files.filter((file) => regex.test(file)).sort();
      return {
        content: [{ type: "text", text: JSON.stringify(matched) }],
        metadata: { count: matched.length }
      };
    }
  };
}

function globToRegex(pattern) {
  let source = pattern
    .replace(/\*\*\//g, "\x00DSTARSLASH\x00")
    .replace(/\*\*/g, "\x00DSTAR\x00")
    .replace(/\*/g, "\x00STAR\x00")
    .replace(/\?/g, "\x00QMARK\x00");
  source = source.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  source = source
    .replace(/\x00DSTARSLASH\x00/g, "(?:.*/)?")
    .replace(/\x00DSTAR\x00/g, ".*")
    .replace(/\x00STAR\x00/g, "[^/]*")
    .replace(/\x00QMARK\x00/g, "[^/]");
  return new RegExp(`^${source}$`);
}
