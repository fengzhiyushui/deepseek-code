import { readWorkspaceTextFile } from "../../workspace/path-safety.js";

export function createReadTool() {
  return {
    name: "read",
    description: "Read a text file from the workspace",
    category: "read",
    side_effect: "none",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: { path: { type: "string", description: "Workspace-relative file path" } },
    execute: async (params, context) => {
      const file = await readWorkspaceTextFile(context.projectRoot, params.path);
      return {
        content: [{ type: "text", text: file.content }],
        metadata: { path: file.path, bytes: file.bytes }
      };
    }
  };
}
