import React, { useMemo, useState } from "react";
import Placeholder from "./Placeholder.jsx";
import { buildTree } from "../state/file-tree.js";
import { shortId } from "../state/workbench-state.js";

function FileIcon({ name }) {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "json") return <span className="ico json">{"{}"}</span>;
  if (ext === "md") return <span className="ico md">MD</span>;
  if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) return <span className="ico js">JS</span>;
  return <span className="ico" style={{ background: "none", color: "var(--text-mut)" }}>·</span>;
}

function TreeNode({ node, depth, expanded, toggle, onOpen, activeFile }) {
  const pad = { paddingLeft: 8 + depth * 14 };
  if (node.type === "dir") {
    const open = expanded.has(node.path);
    return (
      <>
        <button type="button" className="row" style={pad} onClick={() => toggle(node.path)} aria-expanded={open}>
          <span className="chev">{open ? "▾" : "▸"}</span>
          <span className="ico folder">{"📁"}</span>
          <span className="name">{node.name}</span>
        </button>
        {open && node.children.map((c) => (
          <TreeNode key={c.path} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} onOpen={onOpen} activeFile={activeFile} />
        ))}
      </>
    );
  }
  return (
    <button type="button" className={`row ${activeFile === node.path ? "active" : ""}`} style={pad}
      title={node.path} aria-selected={activeFile === node.path} onClick={() => onOpen(node.path)}>
      <span className="chev" />
      <FileIcon name={node.name} />
      <span className="name">{node.name}</span>
    </button>
  );
}

export default function Explorer({ t, state, onSelectBranch, onOpenFile }) {
  const tree = useMemo(() => buildTree(state.fileTree), [state.fileTree]);
  const [expanded, setExpanded] = useState(() => new Set(tree.filter((n) => n.type === "dir").map((n) => n.path)));
  const toggle = (p) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });
  const hasTree = tree.length > 0;

  return (
    <aside className="side" aria-label={t("explorer")}>
      <div className="head"><span>{t("explorer").toUpperCase()}</span></div>
      <div className="project"><span>{"▾"}</span> DEEPSEEK-CODE</div>
      <div className="tree" role="tree">
        {hasTree
          ? tree.map((n) => (
              <TreeNode key={n.path} node={n} depth={0} expanded={expanded} toggle={toggle} onOpen={onOpenFile} activeFile={state.activeFile} />
            ))
          : (
            <Placeholder badge={t("placeholder.badge")} label={t("placeholder.files")}>
              <div>src/</div><div>&nbsp;&nbsp;index.js</div>
            </Placeholder>
          )}

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
