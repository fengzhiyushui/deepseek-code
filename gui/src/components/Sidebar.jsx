import React from "react";
import Placeholder from "./Placeholder.jsx";
import { shortId } from "../state/workbench-state.js";

export default function Sidebar({ state, onSelectBranch }) {
  return (
    <aside className="panel" aria-label="project sidebar">
      <div className="section-title">Branches</div>
      <div role="list">
        {state.branches.length === 0 && (
          <div className="list-item" style={{ color: "var(--ide-muted)" }}>No branches</div>
        )}
        {state.branches.map((b) => {
          const id = b.branch_id || b.id;
          const selected = state.selectedBranchId === id;
          return (
            <div
              key={id}
              role="listitem"
              className="list-item ellipsis"
              aria-selected={selected}
              title={id}
              tabIndex={0}
              onClick={() => onSelectBranch(id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectBranch(id); } }}
            >
              ⑂ {shortId(id)} {id === state.activeBranchId ? "•" : ""}
            </div>
          );
        })}
      </div>

      <div className="section-title">Checkpoints</div>
      <div role="list">
        {state.checkpoints.length === 0 && (
          <div className="list-item" style={{ color: "var(--ide-muted)" }}>No checkpoints</div>
        )}
        {state.checkpoints.slice(-8).map((c, i) => (
          <div key={c.checkpoint_id || c.seq || i} className="list-item ellipsis" title={String(c.summary || c.seq || "")}>
            ◷ {c.summary || `seq ${c.seq ?? "?"}`}
          </div>
        ))}
      </div>

      <div className="section-title">Files</div>
      <Placeholder label="示例文件树(未接入 workspace-indexer)">
        <div>src/</div>
        <div>&nbsp;&nbsp;index.js</div>
        <div>&nbsp;&nbsp;config.js</div>
        <div>&nbsp;&nbsp;tui.js</div>
      </Placeholder>
    </aside>
  );
}
