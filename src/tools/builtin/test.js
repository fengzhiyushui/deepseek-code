import { promises as fs } from "node:fs";
import path from "node:path";
import { createShellTool } from "./shell.js";

export function createTestTool() {
  return {
    name: "test",
    description: "Detect and run the project test suite",
    category: "execute",
    side_effect: "process",
    risk_level: "low",
    source: "builtin",
    version: "2.0",
    params: {
      detect: { type: "boolean", required: false, default: true },
      argv: { type: "array", required: false }
    },
    execute: async (params, context) => {
      const argv = params.argv || await detectTestCommand(context.projectRoot);
      if (!argv) {
        return { content: [{ type: "text", text: "No test command detected." }], metadata: { argv: null } };
      }
      if (params.detect === true && params.argv === undefined) {
        return { content: [{ type: "text", text: `Detected: ${argv.join(" ")}` }], metadata: { argv }, stdout: "", stderr: "" };
      }
      const result = await createShellTool().execute({ argv, cwd: "." }, context);
      return { ...result, metadata: { ...result.metadata, argv } };
    }
  };
}

export async function detectTestCommand(projectRoot) {
  if (await exists(path.join(projectRoot, "package.json"))) return ["npm", "test"];
  if (await exists(path.join(projectRoot, "pytest.ini")) || await exists(path.join(projectRoot, "pyproject.toml"))) return ["pytest"];
  if (await exists(path.join(projectRoot, "Cargo.toml"))) return ["cargo", "test"];
  if (await exists(path.join(projectRoot, "go.mod"))) return ["go", "test", "./..."];
  return ["node", "--test"];
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
