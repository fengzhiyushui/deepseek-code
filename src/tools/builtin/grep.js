import { readWorkspaceTextFile, walkWorkspaceFiles } from "../../workspace/path-safety.js";

export function createGrepTool() {
  return {
    name: "grep",
    description: "Search workspace text files with a JavaScript regular expression",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: {
      pattern: { type: "string", description: "Regular expression pattern" },
      path: { type: "string", default: ".", description: "Workspace-relative path to search" },
      max_matches: { type: "number", required: false, default: 200 }
    },
    execute: async (params, context) => {
      const regex = new RegExp(params.pattern);
      const files = await walkWorkspaceFiles(context.projectRoot, params.path);
      const matches = [];
      for (const filePath of files) {
        if (matches.length >= params.max_matches) break;
        let file;
        try {
          file = await readWorkspaceTextFile(context.projectRoot, filePath, { maxBytes: 1024 * 1024 });
        } catch {
          continue;
        }
        const lines = file.content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (regex.test(lines[index])) {
            matches.push(`${filePath}:${index + 1}:${lines[index]}`);
            if (matches.length >= params.max_matches) break;
          }
        }
      }
      return {
        content: [{ type: "text", text: matches.join("\n") }],
        metadata: { matches: matches.length }
      };
    }
  };
}
