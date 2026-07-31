import React from "react";
import {
  FolderKanban, FolderOpen, Trash2, ChevronLeft, GitCompare, Network, Puzzle,
  FolderSearch, PenLine
} from "lucide-react";
import ChangeDiffView from "../ChangeDiffView.jsx";

// v1.4 次级视图(设计稿 v4 视图 4/5/6/7)。
// 概念预览(MCP / 插件)只保留设计稿的版式与说明,不虚构服务条目 —— 没有数据就给空态。

export function ProjectsView({ t, state, onSwitchProject, onRemoveProject, onOpenFolder, onReveal }) {
  const projects = state.projects || [];
  const current = projects.find((p) => p.root === state.currentProject) || null;
  const others = projects.filter((p) => p.root !== state.currentProject);
  const sessionCount = (id) => {
    const g = (state.sessions || []).find((x) => x.projectDir === id);
    return g ? g.sessions.length : 0;
  };

  const Card = ({ p, isCurrent }) => (
    <div className={`api-item ${isCurrent ? "cur" : ""}`}>
      <span className="ai-ic"><FolderKanban size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="an">{p.name}{isCurrent && <span className="badge">{t("rail.current")}</span>}</div>
        <div className="ad">{p.root} · {t("projects.sessions").replace("{n}", sessionCount(p.id))}</div>
      </div>
      <div className="spacer" />
      {onReveal && <button type="button" className="btn ghost" onClick={() => onReveal(p.root)}><FolderOpen size={12} /> {t("projects.reveal")}</button>}
      {!isCurrent && <button type="button" className="btn ghost" onClick={() => onSwitchProject(p.root)}>{t("projects.open")}</button>}
      {!isCurrent && onRemoveProject && (
        <button type="button" className="btn ghost" title={t("projects.remove")} onClick={() => onRemoveProject(p.root)}>
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );

  return (
    <section className="view on">
      <header className="pane-head">
        <span className="ttl">{t("projects.title")}</span>
        <span className="sub">{t("projects.subtitle")}</span>
        <div className="spacer" />
        <button type="button" className="btn ghost" onClick={onOpenFolder}><FolderOpen size={13} /> {t("rail.openFolder")}</button>
      </header>
      <div className="s-body"><div className="s-in" style={{ maxWidth: 760 }}>
        {current && (
          <div className="f-group">
            <div className="fg-t">{t("projects.current")}</div>
            <Card p={current} isCurrent />
          </div>
        )}
        <div className="f-group">
          <div className="fg-t">{t("projects.recent")}</div>
          {others.map((p) => <Card key={p.id} p={p} isCurrent={false} />)}
          {others.length === 0 && (
            <div className="empty-note">
              <span className="en-ic"><FolderSearch size={24} /></span>
              {t("projects.emptyRecent")}
            </div>
          )}
        </div>
      </div></div>
    </section>
  );
}

// 改动:左 = 逐条改动记录下的文件单(agent / 手动分组),右 = 选中文件的 before↔after diff。
export function ChangesView({ t, state, theme, onOpenChange, onDismissDiff, onReveal }) {
  const changes = state.changes || [];
  const openDiff = state.changeDiff && state.changeDiff.meta ? state.changeDiff : null;
  const openId = openDiff ? openDiff.meta.id : null;
  const openPath = openDiff && openDiff.file ? openDiff.file.path : null;

  const rows = changes.map((c) => ({
    change: c,
    files: (c.files || []).map((f) => (typeof f === "string" ? { path: f } : f))
  }));
  const totalFiles = rows.reduce((n, r) => n + r.files.length, 0);

  return (
    <section className="view on">
      <div className="changes">
        <aside className="c-list">
          <div className="cl-h">{t("changes.agentChanges")}</div>
          {rows.map(({ change, files }) => (
            <React.Fragment key={change.id}>
              <div className="rail-grp" title={change.prompt || ""}>
                {change.time || change.id}{change.rolledBack ? ` · ${t("changes.rolledBack")}` : ""}
              </div>
              {files.map((f) => (
                <button type="button" key={`${change.id}:${f.path}`}
                  className={`c-item ${openId === change.id && openPath === f.path ? "on" : ""}`}
                  onClick={() => onOpenChange(change.id, f.path)}>
                  <span className="c-src">{t("changes.srcAgent")}</span>
                  {f.path}
                  <span className="ps">
                    {f.added != null && <span className="a">+{f.added}</span>}
                    {f.removed != null && <span className="d">−{f.removed}</span>}
                  </span>
                </button>
              ))}
            </React.Fragment>
          ))}
          {totalFiles === 0 && (
            <div className="empty-note">
              <span className="en-ic"><GitCompare size={22} /></span>
              {t("changes.empty")}
            </div>
          )}
        </aside>

        <div className="c-view">
          {openDiff ? (
            <>
              <div className="cv-h">
                <button type="button" className="iconbtn" title={t("diff.close")} onClick={onDismissDiff}><ChevronLeft size={15} /></button>
                <span className="fp">{openPath}</span>
                {openDiff.meta.rolledBack && <span className="mini warn">{t("changes.rolledBack")}</span>}
                <span className="mini">{openDiff.meta.id}</span>
              </div>
              <div className="cv-body">
                <ChangeDiffView t={t} theme={theme} changeDiff={openDiff} onClose={onDismissDiff} onReveal={onReveal} />
              </div>
            </>
          ) : (
            <div className="empty-note" style={{ marginTop: 60 }}>
              <span className="en-ic"><PenLine size={24} /></span>
              {t("changes.pickFile")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// 概念预览:保留设计稿的头部 + 说明段 + 空态,不列虚构条目。
function ConceptView({ t, title, subtitle, icon, note, emptyKey }) {
  return (
    <section className="view on">
      <header className="pane-head">
        <span className="ttl">{title}</span>
        <span className="sub">{subtitle}</span>
        <div className="spacer" />
        <span className="seg">{t("concept.planning")}</span>
      </header>
      <div className="s-body"><div className="s-in" style={{ maxWidth: 760 }}>
        <div className="f-group">
          <div className="fg-t">{t("concept.configured")}</div>
          <div className="empty-note">
            <span className="en-ic">{icon}</span>
            {t(emptyKey)}
          </div>
        </div>
        <div className="f-group">
          <div className="fg-t">{t("concept.note")}</div>
          <p style={{ color: "var(--text-mut)", fontSize: "var(--fs-12)", lineHeight: 1.75, margin: 0 }}>{note}</p>
        </div>
      </div></div>
    </section>
  );
}

export function McpView({ t }) {
  return <ConceptView t={t} title={t("rail.mcp")} subtitle={t("concept.mcpSub")}
    icon={<Network size={26} />} note={t("concept.mcp")} emptyKey="concept.mcpEmpty" />;
}

export function PluginsView({ t }) {
  return <ConceptView t={t} title={t("rail.plugins")} subtitle={t("concept.pluginsSub")}
    icon={<Puzzle size={26} />} note={t("concept.plugins")} emptyKey="concept.pluginsEmpty" />;
}
