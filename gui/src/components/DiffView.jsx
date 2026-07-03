import React from "react";
import { DiffEditor } from "@monaco-editor/react";

// Side-by-side original ↔ modified view for a GUI edit (before/after save).
export default function DiffView({ theme, language, original, modified, onClose, t, title, actions }) {
  return (
    <div className="diffview" role="document" aria-label="diff">
      <div className="diffview-head">
        <span className="name" title={typeof title === "string" ? title : undefined}>
          {title || (t ? t("diff.title") : "Diff")}
        </span>
        {actions || null}
        <button type="button" className="ghost" onClick={onClose} aria-label={t ? t("diff.close") : "Close diff"}>✕</button>
      </div>
      <div className="diffview-body">
        <DiffEditor
          height="100%"
          theme={theme === "day" ? "vs" : "vs-dark"}
          language={language}
          original={original ?? ""}
          modified={modified ?? ""}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            fontFamily: '"Cascadia Code", "Consolas", monospace',
            fontSize: 13,
            scrollBeyondLastLine: false
          }}
        />
      </div>
    </div>
  );
}
