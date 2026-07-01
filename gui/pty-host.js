// gui/pty-host.js — PTY lifecycle wrapper. `spawn` is injected (node-pty in production,
// a mock in tests) so the logic is unit-testable without the native module. When spawn
// is unavailable (node-pty not installed/rebuilt), the host degrades to inert no-ops.

function defaultShell() {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
  return process.env.SHELL || "bash";
}

function createPtyHost({ spawn = null, cwd = process.cwd(), shell = defaultShell(), onData = () => {} } = {}) {
  const available = typeof spawn === "function";
  let pty = null;

  function start(cols = 80, rows = 24) {
    if (!available || pty) return;
    pty = spawn(shell, [], { name: "xterm-color", cols, rows, cwd, env: process.env });
    if (pty && typeof pty.onData === "function") pty.onData((d) => onData(d));
  }
  function write(data) { if (pty) pty.write(data); }
  function resize(cols, rows) { if (pty) pty.resize(cols, rows); }
  function kill() { if (pty) { try { pty.kill(); } catch { /* already gone */ } pty = null; } }

  return { start, write, resize, kill, available };
}

module.exports = { createPtyHost, defaultShell };
