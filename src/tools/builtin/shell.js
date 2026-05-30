import { spawn } from "node:child_process";
import { normalizeShellParams, limitOutput } from "../../security/shell-policy.js";
import { resolveWorkspacePath } from "../../workspace/path-safety.js";

export function createShellTool() {
  return {
    name: "shell",
    description: "Execute a structured argv command inside the workspace",
    category: "execute",
    side_effect: "process",
    risk_level: "medium",
    source: "builtin",
    version: "2.0",
    params: {
      argv: { type: "array", description: "Command and arguments" },
      cwd: { type: "string", required: false, default: "." },
      timeout_ms: { type: "number", required: false, default: 30000 },
      shell: { type: "boolean", required: false, internal: true }
    },
    normalizeParams: normalizeShellParams,
    execute: async (params, context) => {
      const normalized = normalizeShellParams(params);
      const cwd = await resolveWorkspacePath(context.projectRoot, normalized.cwd, { mustExist: true });
      return runProcess(normalized.argv, {
        cwd: cwd.real,
        timeoutMs: normalized.timeout_ms
      });
    }
  };
}

export function runProcess(argv, { cwd, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const out = limitOutput(stdout);
      const err = limitOutput(stderr);
      resolve({
        content: [{ type: "text", text: out.text + (err.text ? `\n${err.text}` : "") }],
        stdout: out.text,
        stderr: err.text,
        metadata: {
          exit_code: code,
          signal,
          stdout_truncated: out.truncated,
          stderr_truncated: err.truncated
        }
      });
    });
  });
}
