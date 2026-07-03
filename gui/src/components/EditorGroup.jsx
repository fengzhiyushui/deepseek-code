import React, { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import Terminal from "./Terminal.jsx";
import DiffView from "./DiffView.jsx";
import ChangeDiffView from "./ChangeDiffView.jsx";
import { derivePanels } from "../state/panels-derive.js";
import { clampLine } from "../state/changes-derive.js";

function tabIco(path) {
  const ext = (path || "").split(".").pop().toLowerCase();
  if (ext === "md") return <span className="ico md" style={{ width: 14, height: 14, fontSize: 9 }}>MD</span>;
  if (ext === "json") return <span className="ico json" style={{ width: 14, height: 14, fontSize: 9 }}>{"{}"}</span>;
  return <span className="ico js" style={{ width: 14, height: 14, fontSize: 9 }}>JS</span>;
}

function baseName(p) { return (p || "").split("/").pop(); }

export default function EditorGroup({ t, state, onActivate, onClose, onEdit, onSave, onCursor, onDismissChangeDiff, onReveal, onRevealConsumed }) {
  const [ptab, setPtab] = useState("terminal");
  const [showDiff, setShowDiff] = useState(false);
  const [monacoTick, setMonacoTick] = useState(0);
  const editorRef = useRef(null);
  const open = state.openFiles || [];
  const active = open.find((f) => f.path === state.activeFile) || null;
  const isDirty = active && state.dirty && state.dirty[active.path];
  const { problems, output } = derivePanels(state.activity, state.errors);
  const ptabs = [
    { k: "problems", label: t("panel.problems"), badge: problems.length },
    { k: "output", label: t("panel.output"), badge: output.length },
    { k: "terminal", label: t("panel.terminal") }
  ];

  const handleMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((e) => {
      if (onCursor) onCursor({ line: e.position.lineNumber, column: e.position.column });
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (state.activeFile && onSave) onSave(state.activeFile);
    });
    setMonacoTick((m) => m + 1);
  };

  // Honor a pending jump-to-line from the change-tracking view once the target
  // file is active, its editor is mounted, and no change diff is covering it.
  useEffect(() => {
    const pr = state.pendingReveal;
    const ed = editorRef.current;
    if (!pr || !ed || state.changeDiff || state.activeFile !== pr.path) return;
    const model = typeof ed.getModel === "function" ? ed.getModel() : null;
    if (!model) return;
    const line = clampLine(pr.line, model.getLineCount());
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    if (typeof ed.focus === "function") ed.focus();
    if (onRevealConsumed) onRevealConsumed();
  }, [state.pendingReveal, state.activeFile, state.changeDiff, monacoTick, onRevealConsumed]);

  return (
    <div className="editor" aria-label="editor">
      <div className="tabs" role="tablist" aria-label="open editors">
        {open.length === 0 && <div className="tab" style={{ color: "var(--text-mut)" }}>—</div>}
        {open.map((f) => (
          <div key={f.path} role="tab" aria-selected={f.path === state.activeFile}
            className={`tab ${f.path === state.activeFile ? "active" : ""}`} title={f.path}
            onClick={() => onActivate(f.path)}>
            {tabIco(f.path)} {baseName(f.path)}
            {state.dirty && state.dirty[f.path]
              ? <span className="dot" title={t("editor.unsaved")} aria-label={t("editor.unsaved")} />
              : <span className="x" role="button" aria-label={`close ${baseName(f.path)}`}
                  onClick={(e) => { e.stopPropagation(); onClose(f.path); }}>✕</span>}
          </div>
        ))}
      </div>

      {state.changeDiff
        ? (
          <>
            <div className="breadcrumb" aria-label="breadcrumb"> </div>
            <div className="code" role="document" aria-label="change diff">
              <ChangeDiffView t={t} theme={state.theme} changeDiff={state.changeDiff}
                onClose={onDismissChangeDiff} onReveal={onReveal} />
            </div>
          </>
        )
        : active
        ? (
          <>
            <div className="breadcrumb" aria-label="breadcrumb">
              <span style={{ flex: 1, display: "flex", gap: 6, alignItems: "center", overflow: "hidden" }}>
                {active.path.split("/").map((seg, i) => (
                  <React.Fragment key={i}>{i > 0 && <span className="sep">›</span>} {seg}</React.Fragment>
                ))}
              </span>
              {isDirty && (
                <>
                  <button type="button" className="bc-btn" onClick={() => setShowDiff((v) => !v)} aria-pressed={showDiff}>{t("diff.title")}</button>
                  <button type="button" className="bc-btn accent" onClick={() => onSave && onSave(active.path)}>{t("menu.save")} (Ctrl+S)</button>
                </>
              )}
            </div>
            <div className="code" role="document" aria-label={active.path}>
              {showDiff && isDirty
                ? <DiffView t={t} theme={state.theme} language={active.language} original={active.original} modified={active.content} onClose={() => setShowDiff(false)} />
                : <Editor
                    height="100%"
                    theme={state.theme === "day" ? "vs" : "vs-dark"}
                    path={active.path}
                    language={active.language}
                    value={active.content}
                    onChange={(val) => onEdit && onEdit(active.path, val ?? "")}
                    onMount={handleMount}
                    options={{
                      readOnly: false,
                      minimap: { enabled: false },
                      fontFamily: '"Cascadia Code", "Consolas", monospace',
                      fontSize: 13,
                      scrollBeyondLastLine: false,
                      lineNumbers: "on",
                      renderWhitespace: "selection",
                      smoothScrolling: true
                    }}
                  />}
            </div>
          </>
        )
        : (
          <>
            <div className="breadcrumb" aria-label="breadcrumb"> </div>
            <div className="code" style={{ display: "grid", placeItems: "center", color: "var(--text-mut)" }}>
              {state.language === "en" ? "Select a file in the Explorer to view it." : "在左侧资源管理器选择文件查看。"}
            </div>
          </>
        )}

      <div className="panel-tabs" role="tablist" aria-label="panel">
        {ptabs.map((p) => (
          <button key={p.k} type="button" role="tab" aria-selected={ptab === p.k} className={`pt ${ptab === p.k ? "active" : ""}`} onClick={() => setPtab(p.k)}>
            {p.label}{p.badge ? <span className="pt-badge">{p.badge}</span> : null}
          </button>
        ))}
        <span className="grow" />
      </div>
      <div className="panel" style={{ padding: 0 }} aria-label={t("panel." + ptab)}>
        <div style={{ height: "100%", display: ptab === "terminal" ? "block" : "none" }}>
          <Terminal theme={state.theme} />
        </div>
        {ptab === "problems" && (
          <div className="panel-list" role="list">
            {problems.length === 0
              ? <div className="dim" style={{ padding: "8px 16px" }}>{t("panel.noProblems")}</div>
              : problems.map((p, i) => (
                  <div key={i} className="panel-row" role="listitem">
                    <span className={`badge-kind ${p.kind}`}>{p.kind}</span> {p.message}
                  </div>
                ))}
          </div>
        )}
        {ptab === "output" && (
          <div className="panel-list" role="list">
            {output.length === 0
              ? <div className="dim" style={{ padding: "8px 16px" }}>{t("panel.noOutput")}</div>
              : output.map((o, i) => (
                  <div key={i} className="panel-row mono" role="listitem"><span className="dim">{o.type}</span> {o.text}</div>
                ))}
          </div>
        )}
      </div>
    </div>
  );
}
