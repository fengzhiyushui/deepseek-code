import React, { useState } from "react";
import Editor from "@monaco-editor/react";

function tabIco(path) {
  const ext = (path || "").split(".").pop().toLowerCase();
  if (ext === "md") return <span className="ico md" style={{ width: 14, height: 14, fontSize: 9 }}>MD</span>;
  if (ext === "json") return <span className="ico json" style={{ width: 14, height: 14, fontSize: 9 }}>{"{}"}</span>;
  return <span className="ico js" style={{ width: 14, height: 14, fontSize: 9 }}>JS</span>;
}

function baseName(p) { return (p || "").split("/").pop(); }

export default function EditorGroup({ t, state, onActivate, onClose }) {
  const [ptab, setPtab] = useState("terminal");
  const open = state.openFiles || [];
  const active = open.find((f) => f.path === state.activeFile) || null;
  const ptabs = [
    { k: "problems", label: t("panel.problems") },
    { k: "output", label: t("panel.output") },
    { k: "debug", label: t("panel.debug") },
    { k: "terminal", label: t("panel.terminal") }
  ];

  return (
    <div className="editor" aria-label="editor">
      <div className="tabs" role="tablist" aria-label="open editors">
        {open.length === 0 && <div className="tab" style={{ color: "var(--text-mut)" }}>—</div>}
        {open.map((f) => (
          <div key={f.path} role="tab" aria-selected={f.path === state.activeFile}
            className={`tab ${f.path === state.activeFile ? "active" : ""}`} title={f.path}
            onClick={() => onActivate(f.path)}>
            {tabIco(f.path)} {baseName(f.path)}
            <span className="x" role="button" aria-label={`close ${baseName(f.path)}`}
              onClick={(e) => { e.stopPropagation(); onClose(f.path); }}>✕</span>
          </div>
        ))}
      </div>

      {active
        ? (
          <>
            <div className="breadcrumb" aria-label="breadcrumb">{active.path.split("/").map((seg, i, a) => (
              <React.Fragment key={i}>{i > 0 && <span className="sep">›</span>} {seg}</React.Fragment>
            ))}</div>
            <div className="code" role="document" aria-label={active.path}>
              <Editor
                height="100%"
                theme={state.theme === "day" ? "vs" : "vs-dark"}
                path={active.path}
                language={active.language}
                value={active.content}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontFamily: '"Cascadia Code", "Consolas", monospace',
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  renderWhitespace: "selection",
                  smoothScrolling: true
                }}
              />
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
          <button key={p.k} type="button" role="tab" aria-selected={ptab === p.k} className={`pt ${ptab === p.k ? "active" : ""}`} onClick={() => setPtab(p.k)}>{p.label}</button>
        ))}
        <span className="grow" />
        <span style={{ color: "var(--text-mut)", fontSize: 10 }}>{t("placeholder.badge")}</span>
      </div>
      <div className="panel" aria-label={t("placeholder.terminal")}>
        <div><span className="prompt">➜</span> <span className="path">deepseek-code</span> npm test</div>
        <div><span className="ok">✔</span> 804 {t("status.passing")} <span className="dim">(4.1s)</span></div>
        <div><span className="prompt">➜</span> <span className="path">deepseek-code</span> <span style={{ color: "var(--text-bright)" }}>▍</span></div>
      </div>
    </div>
  );
}
