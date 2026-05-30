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
