import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../../workspace/path-safety.js";

export function createLsTool() {
  return {
    name: "ls",
    description: "List files and directories inside the workspace",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: { path: { type: "string", default: ".", description: "Workspace-relative directory path" } },
    execute: async (params, context) => {
      const resolved = await resolveWorkspacePath(context.projectRoot, params.path, { mustExist: true });
      const entries = await fs.readdir(resolved.real, { withFileTypes: true });
      const rows = entries.map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`).sort();
      return {
        content: [{ type: "text", text: rows.join("\n") }],
        metadata: { path: resolved.relative || ".", count: rows.length }
      };
    }
  };
}
