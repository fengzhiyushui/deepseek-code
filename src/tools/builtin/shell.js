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
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer = null;
    let child = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    }

    function spawnErrorResult(message) {
      const errOut = limitOutput(stderr || message);
      return {
        content: [{ type: "text", text: `spawn error: ${message}` + (errOut.text ? `\n${errOut.text}` : "") }],
        stdout: "",
        stderr: errOut.text || message,
        metadata: {
          exit_code: null,
          signal: null,
          spawn_error: message,
          stdout_truncated: false,
          stderr_truncated: errOut.truncated
        }
      };
    }

    try {
      child = spawn(argv[0], argv.slice(1), { cwd, shell: false, windowsHide: true });
    } catch (err) {
      finish(spawnErrorResult(err.message));
      return;
    }

    timer = setTimeout(() => { child.kill(); }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      finish(spawnErrorResult(err.message));
    });

    child.on("close", (code, signal) => {
      const out = limitOutput(stdout);
      const err = limitOutput(stderr);
      finish({
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
