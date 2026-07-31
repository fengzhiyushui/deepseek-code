import React from "react";
import { FolderKanban, Network, Puzzle, GitCompare, Trash2, ChevronLeft } from "lucide-react";
import ChangeDiffView from "../ChangeDiffView.jsx";

// 项目视图:全局 MRU 列表 + 当前项目;打开(切换)/移除。
export function ProjectsView({ t, state, onSwitchProject, onRemoveProject }) {
  return (
    <section className="view on">
      <header className="pane-head"><span className="ttl">{t("rail.projects")}</span></header>
      <div className="c-list" style={{ padding: 20, maxWidth: 640 }}>
        {state.projects.map((p) => (
          <div key={p.id} className="c-item" style={{ cursor: "pointer" }} onClick={() => onSwitchProject && onSwitchProject(p.root)}>
            <FolderKanban size={14} style={{ color: "var(--accent)" }} />
            <span className="tt">{p.name}{p.root === state.currentProject && <span className="cur">当前</span>}</span>
            <span className="s">{p.root}</span>
            {onRemoveProject && (
              <button className="ghost" title={t("projects.remove")} onClick={(e) => { e.stopPropagation(); onRemoveProject(p.root); }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {state.projects.length === 0 && <div style={{ color: "var(--text-mut)" }}>{t("rail.noProjects")}</div>}
      </div>
    </section>
  );
}

// 改动视图:改动列表 + 选中后 Monaco before/after diff(沿 D-4 changes:list/describe)。
export function ChangesView({ t, state, theme, onOpenChange, onDismissDiff, onReveal }) {
  const changes = state.changes || [];
  const openDiff = state.changeDiff && state.changeDiff.meta ? state.changeDiff : null;
  const file = changes.find((c) => c.id === (openDiff && openDiff.meta && openDiff.meta.id));
  return (
    <section className="view on">
      <header className="pane-head">
        <span className="ttl">{t("rail.changes")}</span>
        <div className="spacer" />
        {openDiff && <button className="iconbtn" onClick={onDismissDiff} title={t("diff.close")}><ChevronLeft size={14} /></button>}
      </header>
      {openDiff ? (
        <ChangeDiffView t={t} theme={theme} changeDiff={openDiff}
          onClose={onDismissDiff} onReveal={onReveal} />
      ) : (
        <div className="c-list" style={{ padding: 20, maxWidth: 640 }}>
          {changes.map((c) => (
            <button key={c.id} className="c-item" onClick={() => onOpenChange && onOpenChange(c.id, c.files && c.files[0])}>
              <GitCompare size={14} style={{ color: "var(--accent)" }} />
              <span className="tt">{c.prompt || c.id}</span>
              <span className="s">{c.time || ""} · {(c.files || []).length} 文件</span>
            </button>
          ))}
          {changes.length === 0 && <div style={{ color: "var(--text-mut)" }}>{t("changes.empty")}</div>}
        </div>
      )}
    </section>
  );
}

function ConceptPreview({ t, title, icon, desc }) {
  return (
    <section className="view on">
      <header className="pane-head"><span className="ttl">{title}</span></header>
      <div className="home">
        <div className="home-in" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, color: "var(--text-mut)", marginBottom: 16 }}>{icon}</div>
          <div className="sub" style={{ color: "var(--text-mut)", marginBottom: 8 }}>{desc}</div>
          <span className="mini warn" style={{ marginTop: 8 }}>{t("concept.planning")}</span>
        </div>
      </div>
    </section>
  );
}

// MCP 服务 / 插件:概念预览(静态说明 + 空态,不做功能语义)。
export function McpView({ t }) {
  return <ConceptPreview t={t} title={t("rail.mcp")} icon={<Network size={40} />} desc={t("concept.mcp")} />;
}
export function PluginsView({ t }) {
  return <ConceptPreview t={t} title={t("rail.plugins")} icon={<Puzzle size={40} />} desc={t("concept.plugins")} />;
}
