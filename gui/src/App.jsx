import React, { useCallback, useEffect, useState } from "react";
import { useWorkbench } from "./hooks/useWorkbench.js";
import { useKernel } from "./hooks/useKernel.js";
import { layoutForWidth } from "./state/layout.js";
import { makeT } from "./i18n/strings.js";
import TitleBar from "./components/TitleBar.jsx";
import Rail from "./components/v4/Rail.jsx";
import HomeView from "./components/v4/HomeView.jsx";
import ChatView from "./components/v4/ChatView.jsx";
import { ProjectsView, ChangesView, McpView, PluginsView } from "./components/v4/SecondaryViews.jsx";
import Settings from "./components/Settings/Settings.jsx";

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
  const t = makeT(state.language);
  const view = state.view;

  useEffect(() => { document.documentElement.setAttribute("theme", state.theme); }, [state.theme]);
  useEffect(() => { document.documentElement.lang = state.language; }, [state.language]);
  useEffect(() => { kernel.refreshChanges(); }, [state.changesTick, kernel]);
  useEffect(() => {
    if (state.currentProject) kernel.loadSessions().catch(() => {});
  }, [state.currentProject, kernel]);

  const setView = useCallback((v) => dispatch({ type: "view_changed", view: v }), [dispatch]);

  const onSwitchProject = useCallback((root) => {
    if (!root) return;
    kernel.switchProject(root)
      .then(() => {
        dispatch({ type: "project_switched", root });
        return kernel.loadSessions().catch(() => {});
      })
      .catch(() => { /* 目录不存在等:静默 */ });
  }, [kernel, dispatch]);

  const onNewSession = useCallback((root) => {
    if (root && root !== state.currentProject) onSwitchProject(root);
    else dispatch({ type: "project_switched", root: root || state.currentProject });
    setView("chat");
  }, [state.currentProject, onSwitchProject, dispatch, setView]);

  const actions = {
    send: (text) => { dispatch({ type: "message_added", message: { role: "user", text } }); kernel.send(text); },
    approve: (id, d) => kernel.approve(id, d),
    interrupt: () => kernel.interrupt()
  };

  const toggleTheme = useCallback(() => {
    const next = state.theme === "sumi" ? "latte" : "sumi";
    dispatch({ type: "theme_changed", theme: next });
    kernel.setPreferences({ theme: next });
  }, [state.theme, dispatch, kernel]);
  const toggleLang = useCallback(() => {
    const next = state.language === "zh" ? "en" : "zh";
    dispatch({ type: "language_changed", language: next });
    kernel.setPreferences({ language: next });
  }, [state.language, dispatch, kernel]);
  const menuActions = {
    "view.home": () => setView("home"),
    "view.settings": () => setView("settings"),
    "view.theme": toggleTheme,
    "view.lang": toggleLang,
    "help.about": () => setView("settings")
  };

  return (
    <div className="ide">
      <TitleBar t={t} language={state.language} theme={state.theme} title="Inkstone"
        railView={view} onToggleTheme={toggleTheme} onToggleLang={toggleLang} menuActions={menuActions} />
      <div className="shell">
        <Rail t={t} state={state} kernel={kernel} setView={setView}
          onSwitchProject={onSwitchProject} onNewSession={onNewSession} />
        <main className="pane">
          {view === "home" && <HomeView t={t} state={state} actions={actions} setView={setView} onSwitchProject={onSwitchProject} />}
          {view === "chat" && <ChatView t={t} state={state} actions={actions} kernel={kernel} metrics={state.metrics} />}
          {view === "projects" && <ProjectsView t={t} state={state} onSwitchProject={onSwitchProject} onRemoveProject={(root) => kernel.removeProject(root)} />}
          {view === "changes" && <ChangesView t={t} state={state} theme={state.theme}
            onOpenChange={(id, path) => kernel.openChangeDiff(id, path)}
            onDismissDiff={() => kernel.dismissChangeDiff()}
            onReveal={(p, line) => kernel.revealInEditor(p, line)} />}
          {view === "mcp" && <McpView t={t} />}
          {view === "plugins" && <PluginsView t={t} />}
          {view === "settings" && <Settings t={t} state={state} kernel={kernel} dispatch={dispatch} />}
        </main>
      </div>
    </div>
  );
}
