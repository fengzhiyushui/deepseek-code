import React, { useMemo, useState } from "react";
import Placeholder from "./Placeholder.jsx";
import Icon from "./Icons.jsx";
import { buildTree } from "../state/file-tree.js";
import { filterTree } from "../state/file-filter.js";
import { shortId } from "../state/workbench-state.js";

function FileIcon({ name }) {
  const ext = name.split(".").pop().toLowerCase();
  if (ext === "json") return <span className="ico json">{"{}"}</span>;
  if (ext === "md") return <span className="ico md">MD</span>;
  if (["js", "mjs", "cjs", "jsx", "ts", "tsx"].includes(ext)) return <span className="ico js">JS</span>;
  return <span className="ico" style={{ background: "none", color: "var(--text-mut)" }}>·</span>;
}

function TreeNode({ node, depth, expanded, toggle, onOpen, activeFile, dirty }) {
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
          <TreeNode key={c.path} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} onOpen={onOpen} activeFile={activeFile} dirty={dirty} />
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
      {dirty && dirty[node.path] && <span className="flag" style={{ color: "var(--text)" }}>{"●"}</span>}
    </button>
  );
}

// Collect every directory path in a tree — used to auto-expand search results.
function allDirPaths(nodes, acc = new Set()) {
  for (const n of nodes || []) {
    if (n.type === "dir") { acc.add(n.path); allDirPaths(n.children, acc); }
  }
  return acc;
}

function FileTreeView({ tree, expanded, toggle, onOpen, activeFile, dirty, emptyPh }) {
  if (!tree.length) return emptyPh;
  return tree.map((n) => (
    <TreeNode key={n.path} node={n} depth={0} expanded={expanded} toggle={toggle} onOpen={onOpen} activeFile={activeFile} dirty={dirty} />
  ));
}

export default function Explorer({ t, state, view = "explorer", onSelectBranch, onOpenFile, onSelectCheckpoint }) {
  const tree = useMemo(() => buildTree(state.fileTree), [state.fileTree]);
  const [expanded, setExpanded] = useState(() => new Set(tree.filter((n) => n.type === "dir").map((n) => n.path)));
  const [query, setQuery] = useState("");
  const toggle = (p) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(p) ? next.delete(p) : next.add(p);
    return next;
  });

  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);
  const searchExpanded = useMemo(() => (query.trim() ? allDirPaths(filtered) : expanded), [query, filtered, expanded]);
  const emptyPh = (
    <Placeholder badge={t("placeholder.badge")} label={t("placeholder.files")}>
      <div>src/</div><div>&nbsp;&nbsp;index.js</div>
    </Placeholder>
  );

  const heads = {
    explorer: t("explorer"), search: t("rail.search"), scm: t("rail.scm"), run: t("rail.run"), ext: t("rail.ext")
  };

  return (
    <aside className="side" aria-label={heads[view] || t("explorer")}>
      <div className="head"><span>{(heads[view] || t("explorer")).toUpperCase()}</span></div>

      {view === "search" && (
        <div className="search-box">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")} aria-label={t("rail.search")} autoFocus />
        </div>
      )}

      {(view === "explorer" || view === "search") && (
        <>
          {view === "explorer" && <div className="project"><span>{"▾"}</span> DEEPSEEK-CODE</div>}
          <div className="tree" role="tree">
            {view === "search" && query.trim() && filtered.length === 0
              ? <div className="row" style={{ color: "var(--text-mut)" }}><span className="chev" />{t("search.noResults")}</div>
              : <FileTreeView tree={view === "search" ? filtered : tree} expanded={searchExpanded} toggle={toggle}
                  onOpen={onOpenFile} activeFile={state.activeFile} dirty={state.dirty} emptyPh={emptyPh} />}
          </div>
        </>
      )}

      {view === "scm" && (
        <div className="tree" role="tree">
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
          {state.checkpoints.slice(-8).map((c, i) => (
            <button key={c.checkpoint_id || i} type="button" className="row" title={String(c.summary || c.seq || "")}
              onClick={() => onSelectCheckpoint && onSelectCheckpoint(c)}>
              <span className="chev" /><span className="name">{"◷"} {c.summary || `seq ${c.seq ?? "?"}`}</span>
            </button>
          ))}
        </div>
      )}

      {(view === "run" || view === "ext") && (
        <div className="tree" role="tree" style={{ padding: "12px 0" }}>
          <div className="empty-view" role="note">
            <Icon name={view === "run" ? "run" : "ext"} size={28} />
            <p>{view === "run" ? t("run.empty") : t("ext.empty")}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
