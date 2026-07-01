import React, { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// Interactive terminal: xterm ↔ node-pty (via main-process pty bridge). Degrades to a
// message when the pty bridge is unavailable (node-pty not loaded).
export default function Terminal({ theme }) {
  const ref = useRef(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.deepseek : null;
    if (!api || !api.ptyStart) { setUnavailable(true); return undefined; }

    const dark = theme !== "day";
    const term = new XTerm({
      fontFamily: '"Cascadia Code", "Consolas", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: dark ? "#181818" : "#ffffff",
        foreground: dark ? "#cccccc" : "#333333",
        cursor: "#4ea1ff"
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    try { fit.fit(); } catch { /* container not sized yet */ }

    term.onData((d) => api.ptyInput(d));
    const off = api.onPtyData ? api.onPtyData((d) => term.write(d)) : null;

    (async () => {
      const res = await api.ptyStart(term.cols || 80, term.rows || 24);
      if (res && res.available === false) {
        setUnavailable(true);
        term.write("\r\n\x1b[33m[终端不可用:node-pty 未加载 / terminal unavailable]\x1b[0m\r\n");
      }
    })();

    const onResize = () => {
      try { fit.fit(); api.ptyResize(term.cols, term.rows); } catch { /* ignore */ }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (off) off();
      api.ptyKill && api.ptyKill();
      term.dispose();
    };
    // mount once; theme change does not respawn the pty (avoids losing the session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (unavailable) {
    return <div style={{ padding: "8px 16px", color: "var(--text-mut)" }}>终端不可用(node-pty 未加载) / terminal unavailable</div>;
  }
  return <div ref={ref} style={{ height: "100%", width: "100%", padding: "4px 8px" }} aria-label="terminal" />;
}
