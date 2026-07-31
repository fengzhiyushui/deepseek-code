import React, { useState } from "react";
import { Home, FolderKanban, GitCompare, Network, Puzzle, Search, Plus, ChevronDown, ChevronRight, FolderPlus, MessageSquare, FilePlus2 } from "lucide-react";

// v1.4.0 侧栏:上=功能区(固定)、中=项目分区(每项目独立、内挂会话)、下=独立对话。
export default function Rail({ t, state, kernel, setView, onSwitchProject, onNewSession }) {
  const view = state.view;
  const projects = state.projects || [];
  const sessions = state.sessions || [];
  const currentRoot = state.currentProject;
  const [newMenu, setNewMenu] = useState(false);
  const [expanded, setExpanded] = useState({}); // 项目展开状态(id → bool)
  const [query, setQuery] = useState("");

  const fn = [
    { id: "home", label: t("rail.home"), icon: <Home size={16} /> },
    { id: "projects", label: t("rail.projects"), icon: <FolderKanban size={16} />, badge: projects.length || null },
    { id: "changes", label: t("rail.changes"), icon: <GitCompare size={16} /> },
    { id: "mcp", label: t("rail.mcp"), icon: <Network size={16} /> },
    { id: "plugins", label: t("rail.plugins"), icon: <Puzzle size={16} /> }
  ];

  const projectSessions = (projectDir) => {
    const group = sessions.find((p) => p.projectDir === projectDir);
    return group ? group.sessions : [];
  };

  const isExpanded = (id) => expanded[id] !== false; // 默认展开

  return (
    <aside className="rail">
      <div className="rail-brand">
        <span className="lg"><FilePlus2 size={14} /></span>
        <span className="nm">Inkstone</span>
        <span className="vv">v1.4.0</span>
      </div>

      <div className="newwrap">
        <button className="rail-new" onClick={() => onNewSession && onNewSession()} title={t("rail.newSession")}>
          <Plus size={14} /> {t("rail.newSession")}<span className="kbd">Ctrl N</span>
        </button>
        <button className="new-more" onClick={() => setNewMenu(!newMenu)} title={t("rail.newWhere")}><ChevronDown size={12} /></button>
        {newMenu && (
          <div className="new-menu">
            <div className="nm-h">{t("rail.newWhere")}</div>
            {projects.map((p) => (
              <div key={p.id} className={`nm-i ${p.root === currentRoot ? "on" : ""}`} onClick={() => { setNewMenu(false); onSwitchProject && onSwitchProject(p.root); }}>
                <span className="d" />
                <div>
                  <div className="t">{p.name}{p.root === currentRoot && <span className="cur">{t("rail.current")}</span>}</div>
                  <div className="s">{t("rail.inheritDir")}</div>
                </div>
              </div>
            ))}
            <div className="nm-sep" />
            <div className="nm-i" onClick={() => { setNewMenu(false); onNewSession && onNewSession(null); }}>
              <span className="d free" /><div><div className="t">{t("rail.standalone")}</div><div className="s">{t("rail.noProject")}</div></div>
            </div>
            <div className="nm-i" onClick={() => { setNewMenu(false); kernel && kernel.addProject && onSwitchProject && onSwitchProject(); }}>
              <span className="d free" /><div><div className="t">{t("rail.openFolder")}</div><div className="s">{t("rail.onlyNew")}</div></div>
            </div>
          </div>
        )}
      </div>

      <div className="rail-search">
        <input placeholder={t("rail.searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <nav className="rail-fn">
        {fn.map((item) => (
          <button key={item.id} className={`fn-item ${view === item.id ? "on" : ""}`} onClick={() => setView(item.id)}>
            <span className="ic">{item.icon}</span><span className="tt">{item.label}</span>
            {item.badge ? <span className="badge">{item.badge}</span> : null}
          </button>
        ))}
      </nav>
      <div className="rail-div" />

      <div className="rail-scroll">
        <div className="sec-head"><span className="chev"><ChevronDown size={11} /></span>{t("rail.projects")}
          <span className="add" title={t("rail.openFolder")} onClick={() => onSwitchProject && onSwitchProject()}><FolderPlus size={12} /></span>
        </div>
        <div className="sec-body">
          {projects.length === 0 && (
            <div className="r-item"><span className="tt" style={{ color: "var(--text-faint)" }}>{t("rail.noProjects")}</span></div>
          )}
          {projects.map((p) => {
            const open = isExpanded(p.id);
            const list = projectSessions(p.id);
            return (
              <div key={p.id} className={`proj ${p.root === currentRoot ? "cur" : ""} ${open ? "open" : ""}`}>
                <div className="proj-h" onClick={() => setExpanded((prev) => ({ ...prev, [p.id]: !open }))}>
                  <span className="chev">{open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
                  <span className="dot" />
                  <span className="nm" title={p.root}>{p.name}</span>
                  {p.root === currentRoot && <span className="tag">{t("rail.current")}</span>}
                  <span className="cnt">{list.length}</span>
                  <button className="pnew" title={t("rail.newInProject")} onClick={(e) => { e.stopPropagation(); onNewSession && onNewSession(p.root); }}><Plus size={12} /></button>
                </div>
                {open && (
                  <div className="proj-b">
                    {list.length === 0 && <div className="r-item"><span className="tt" style={{ color: "var(--text-faint)" }}>{t("rail.noSessions")}</span></div>}
                    {list.map((s) => (
                      <button key={s.id} className="r-item" onClick={() => { onSwitchProject && onSwitchProject(p.root); setView("chat"); }}>
                        <span className="tt">{s.summary || t("rail.untitled")}</span>
                        <span className="xx">{new Date(s.mtime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </button>
                    ))}
                    {list.length > 0 && <button className="proj-more" onClick={() => setView("projects")}>{t("rail.allSessions").replace("{n}", list.length)}</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="sec-head"><span className="chev"><ChevronDown size={11} /></span>{t("rail.standalone")}</div>
        <div className="sec-body">
          <div className="r-item" onClick={() => { setView("chat"); }}>
            <MessageSquare size={13} style={{ marginRight: 6, color: "var(--text-mut)" }} />
            <span className="tt">{t("rail.newStandalone")}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
