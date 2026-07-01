import React, { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "./hooks/useWorkbench.js";
import { useKernel } from "./hooks/useKernel.js";
import { layoutForWidth } from "./state/layout.js";
import { makeT } from "./i18n/strings.js";
import TitleBar from "./components/TitleBar.jsx";
import ActivityBar from "./components/ActivityBar.jsx";
import Explorer from "./components/Explorer.jsx";
import EditorGroup from "./components/EditorGroup.jsx";
import AgentPanel from "./components/AgentPanel.jsx";
import StatusBar from "./components/StatusBar.jsx";

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
  const [activeAct, setActiveAct] = useState("agent");
  const t = makeT(state.language);

  useEffect(() => {
    document.body.setAttribute("theme-mode", state.theme !== "day" ? "dark" : "light");
  }, [state.theme]);
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);

  const toggleTheme = useCallback(() => {
    const next = state.theme === "day" ? "night" : "day";
    dispatch({ type: "theme_changed", theme: next });
    kernel.setPreferences({ theme: next });
  }, [state.theme, dispatch, kernel]);

  const toggleLang = useCallback(() => {
    const next = state.language === "zh" ? "en" : "zh";
    dispatch({ type: "language_changed", language: next });
    kernel.setPreferences({ language: next });
  }, [state.language, dispatch, kernel]);

  const selectBranch = useCallback((id) => dispatch({ type: "branch_selected", branch_id: id }), [dispatch]);

  const actions = {
    send: (text) => { dispatch({ type: "message_added", message: { role: "user", text } }); kernel.send(text); },
    approve: (id, d) => kernel.approve(id, d),
    interrupt: () => kernel.interrupt()
  };

  const cols = [
    layout.rail ? "var(--rail)" : null,
    layout.sidebar ? "var(--sidebar)" : null,
    "1fr",
    layout.chat ? "var(--agent)" : null
  ].filter(Boolean).join(" ");

  return (
    <div className="ide">
      <TitleBar t={t} language={state.language} theme={state.theme} title="index.js — deepseek-code" onToggleTheme={toggleTheme} onToggleLang={toggleLang} />
      <div className="body" style={{ gridTemplateColumns: cols }}>
        {layout.rail && <ActivityBar t={t} active={activeAct} onSelect={setActiveAct} />}
        {layout.sidebar && <Explorer t={t} state={state} onSelectBranch={selectBranch} onOpenFile={kernel.openFile} />}
        <EditorGroup t={t} state={state}
          onActivate={(p) => dispatch({ type: "file_activated", path: p })}
          onClose={(p) => dispatch({ type: "file_closed", path: p })} />
        {layout.chat && <AgentPanel t={t} state={state} actions={actions} />}
      </div>
      <StatusBar t={t} state={state} offline={!kernel.available} />
    </div>
  );
}
