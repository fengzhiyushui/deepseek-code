import React from "react";
import { shortId } from "../state/workbench-state.js";

const FILES = [
  { n: "src", type: "folder", chev: "▾", i: 0 },
  { n: "core", type: "folder", chev: "▸", i: 1 },
  { n: "index.js", type: "js", i: 1, active: true },
  { n: "config.js", type: "js", i: 1, flag: "m" },
  { n: "tui.js", type: "js", i: 1, flag: "u" },
  { n: "deepseek", type: "folder", chev: "▸", i: 1 },
  { n: "tools", type: "folder", chev: "▸", i: 1 },
  { n: "gui", type: "folder", chev: "▸", i: 0 },
  { n: "docs", type: "folder", chev: "▸", i: 0 },
  { n: "package.json", type: "json", i: 0 },
  { n: "README.md", type: "md", i: 0 }
];

function Ico({ type }) {
  if (type === "folder") return <span className="ico folder">{"📁"}</span>;
  const label = type === "json" ? "{}" : type === "md" ? "MD" : "JS";
  return <span className={`ico ${type}`}>{label}</span>;
}

export default function Explorer({ t, state, onSelectBranch }) {
  return (
    <aside className="side" aria-label={t("explorer")}>
      <div className="head">
        <span>{t("explorer").toUpperCase()}</span>
        <span style={{ color: "var(--text-mut)", fontSize: 10 }}>{t("placeholder.badge")}</span>
      </div>
      <div className="project"><span>{"▾"}</span> DEEPSEEK-CODE</div>
      <div className="tree" role="tree" aria-label={t("placeholder.files")}>
        {FILES.map((f, idx) => (
          <div key={idx} className={`row indent-${f.i} ${f.active ? "active" : ""}`} role="treeitem" tabIndex={f.active ? 0 : -1}>
            <span className="chev">{f.chev || ""}</span>
            <Ico type={f.type} />
            <span className="name">{f.n}</span>
            {f.flag && <span className={`flag ${f.flag}`}>{f.flag.toUpperCase()}</span>}
          </div>
        ))}

        <div className="section-head">{t("branches")}</div>
        {state.branches.length === 0 && (
          <div className="row" style={{ color: "var(--text-mut)" }}><span className="chev" />{t("noBranches")}</div>
        )}
        {state.branches.map((b) => {
          const id = b.branch_id || b.id;
          return (
            <button key={id} type="button" className={`row ${state.selectedBranchId === id ? "active" : ""}`} title={id}
              aria-selected={state.selectedBranchId === id} onClick={() => onSelectBranch(id)}>
              <span className="chev" /><span className="name">{"⥂"} {shortId(id)}</span>
              {id === state.activeBranchId && <span className="flag" style={{ color: "var(--accent)" }}>{"•"}</span>}
            </button>
          );
        })}

        <div className="section-head">{t("checkpoints")}</div>
        {state.checkpoints.length === 0 && (
          <div className="row" style={{ color: "var(--text-mut)" }}><span className="chev" />{t("noCheckpoints")}</div>
        )}
        {state.checkpoints.slice(-6).map((c, i) => (
          <div key={c.checkpoint_id || i} className="row" title={String(c.summary || c.seq || "")}>
            <span className="chev" /><span className="name">{"◷"} {c.summary || `seq ${c.seq ?? "?"}`}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
