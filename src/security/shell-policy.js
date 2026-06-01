import { spawn } from "node:child_process";

export function normalizeShellParams(raw = {}) {
  if (typeof raw.cmd === "string") {
    throw new Error("Shell cmd string is not supported. Use structured argv.");
  }
  const argv = raw.argv;
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("argv must contain at least one command entry");
  }
  if (!argv.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error("argv entries must be non-empty strings");
  }
  return {
    argv,
    cwd: typeof raw.cwd === "string" && raw.cwd.length > 0 ? raw.cwd : ".",
    timeout_ms: clampTimeout(raw.timeout_ms),
    shell: false
  };
}

export function limitOutput(text = "", maxChars = 32000) {
  const value = String(text);
  return {
    text: value.slice(0, maxChars),
    truncated: value.length > maxChars,
    original_length: value.length
  };
}

function clampTimeout(value) {
  const numeric = Number(value || 30000);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30000;
  return Math.min(numeric, 120000);
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
