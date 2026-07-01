import React, { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "./hooks/useWorkbench.js";
import { useKernel } from "./hooks/useKernel.js";
import { layoutForWidth } from "./state/layout.js";
import { statusSummary, metricsFromUsage } from "./state/workbench-state.js";
import TopBar from "./components/TopBar.jsx";
import ActivityRail from "./components/ActivityRail.jsx";
import Sidebar from "./components/Sidebar.jsx";
import CodeWorkspace from "./components/CodeWorkspace.jsx";
import ChatPanel from "./components/ChatPanel.jsx";

function useViewportLayout() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1440);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return layoutForWidth(w);
}

export default function App() {
  const [state, dispatch] = useWorkbench();
  const kernel = useKernel(dispatch);
  const layout = useViewportLayout();

  useEffect(() => {
    const dark = state.theme !== "day";
    document.body.setAttribute("theme-mode", dark ? "dark" : "light");
  }, [state.theme]);

  const toggleTheme = useCallback(() => {
    const next = state.theme === "day" ? "night" : "day";
    dispatch({ type: "theme_changed", theme: next });
    kernel.setPreferences({ theme: next });
  }, [state.theme, dispatch, kernel]);

  const selectRail = useCallback((mode) => dispatch({ type: "rail_mode_changed", mode }), [dispatch]);
  const selectBranch = useCallback((id) => dispatch({ type: "branch_selected", branch_id: id }), [dispatch]);

  const actions = {
    send: (text) => { dispatch({ type: "message_added", message: { role: "user", text } }); kernel.send(text); },
    approve: (id, decision) => kernel.approve(id, decision),
    interrupt: () => kernel.interrupt()
  };

  // Dynamic column template from the responsive layout contract (§6.1).
  const cols = [
    layout.rail ? "var(--ide-rail)" : null,
    layout.sidebar ? "var(--ide-sidebar)" : null,
    "1fr",
    layout.chat ? "var(--ide-chat)" : null
  ].filter(Boolean).join(" ");

  const summary = statusSummary(state);
  const metrics = state.metrics || metricsFromUsage({});

  return (
    <div className="app-shell">
      <TopBar state={state} onToggleTheme={toggleTheme} />
      <div className="app-body" style={{ gridTemplateColumns: cols }}>
        {layout.rail && <ActivityRail railMode={state.railMode} onSelect={selectRail} />}
        {layout.sidebar && <Sidebar state={state} onSelectBranch={selectBranch} />}
        <CodeWorkspace />
        {layout.chat && <ChatPanel state={state} actions={actions} />}
      </div>
      <footer className="statusbar" role="contentinfo">
        <span className="seg">{summary.runtime}</span>
        <span className="seg" title={summary.branch}>⑂ {summary.branch}</span>
        <span className="seg">autonomy: {summary.autonomy}</span>
        <span className="seg">tokens {metrics.tokens} · cache {metrics.cacheRate} · {metrics.latency}</span>
        {!kernel.available && (
          <span className="seg" style={{ color: "var(--ide-amber)" }}>offline (no kernel bridge)</span>
        )}
      </footer>
    </div>
  );
}
