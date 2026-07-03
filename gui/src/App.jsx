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
import Settings from "./components/Settings/Settings.jsx";
import RewindDialog from "./components/RewindDialog.jsx";

function useViewportLayout() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1440);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return layoutForWidth(w);
}

function baseName(p) { return (p || "").split("/").pop(); }

export default function App() {
  const [state, dispatch] = useWorkbench();
  const kernel = useKernel(dispatch);
  const layout = useViewportLayout();
  const t = makeT(state.language);
  const railView = state.railView;
  const showSettings = railView === "settings";
  const sidebarView = railView === "agent" ? "explorer" : railView;

  useEffect(() => {
    document.body.setAttribute("theme-mode", state.theme !== "day" ? "dark" : "light");
  }, [state.theme]);
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);
  useEffect(() => { kernel.refreshChanges(); }, [state.changesTick, kernel]);

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

  const setView = useCallback((view) => dispatch({ type: "rail_view_changed", view }), [dispatch]);
  const selectBranch = useCallback((id) => dispatch({ type: "branch_selected", branch_id: id }), [dispatch]);
  const activateBranch = useCallback((id) => kernel.activateBranch(id), [kernel]);
  const selectCheckpoint = useCallback((cp) => { dispatch({ type: "checkpoint_selected", checkpoint: cp }); kernel.previewRewind(cp); }, [dispatch, kernel]);

  const actions = {
    send: (text) => { dispatch({ type: "message_added", message: { role: "user", text } }); kernel.send(text); },
    approve: (id, d) => kernel.approve(id, d),
    interrupt: () => kernel.interrupt(),
    openChange: (id, p) => kernel.openChangeDiff(id, p)
  };

  const menuActions = {
    "view.explorer": () => setView("explorer"),
    "view.search": () => setView("search"),
    "view.settings": () => setView("settings"),
    "view.theme": toggleTheme,
    "view.lang": toggleLang,
    "file.save": () => { if (state.activeFile) kernel.saveFile(state.activeFile, state); },
    "help.about": () => setView("settings")
  };

  const activeTitle = showSettings
    ? t("rail.settings")
    : (state.activeFile ? `${baseName(state.activeFile)}${state.dirty[state.activeFile] ? " ●" : ""} — deepseek-code` : "deepseek-code");

  const showSidebar = layout.sidebar && !showSettings;
  const cols = [
    layout.rail ? "var(--rail)" : null,
    showSidebar ? "var(--sidebar)" : null,
    "1fr",
    layout.chat && !showSettings ? "var(--agent)" : null
  ].filter(Boolean).join(" ");

  return (
    <div className="ide">
      <TitleBar t={t} language={state.language} theme={state.theme} title={activeTitle}
        railView={railView} onToggleTheme={toggleTheme} onToggleLang={toggleLang} menuActions={menuActions} />
      <div className="body" style={{ gridTemplateColumns: cols }}>
        {layout.rail && <ActivityBar t={t} active={railView} onSelect={setView} />}
        {showSidebar && (
          <Explorer t={t} state={state} view={sidebarView}
            onSelectBranch={(id) => { selectBranch(id); activateBranch(id); }}
            onOpenFile={kernel.openFile} onSelectCheckpoint={selectCheckpoint}
            onOpenChange={kernel.openChangeDiff} offline={!kernel.available} />
        )}
        {showSettings
          ? <Settings t={t} state={state} kernel={kernel} dispatch={dispatch} />
          : <EditorGroup t={t} state={state}
              onActivate={(p) => dispatch({ type: "file_activated", path: p })}
              onClose={(p) => dispatch({ type: "file_closed", path: p })}
              onEdit={(p, content) => dispatch({ type: "file_edited", path: p, content })}
              onSave={(p) => kernel.saveFile(p, state)}
              onCursor={(pos) => dispatch({ type: "cursor_moved", position: pos })}
              onDismissChangeDiff={kernel.dismissChangeDiff}
              onReveal={(p, line) => kernel.revealInEditor(p, line)}
              onRevealConsumed={() => dispatch({ type: "reveal_consumed" })} />}
        {layout.chat && !showSettings && <AgentPanel t={t} state={state} actions={actions} />}
      </div>
      <StatusBar t={t} state={state} offline={!kernel.available} />
      {state.rewindPreview && <RewindDialog t={t} state={state} kernel={kernel} dispatch={dispatch} />}
    </div>
  );
}
