import React from "react";
import { FolderKanban, Network, Puzzle, GitCompare } from "lucide-react";

// 项目视图:全局 MRU 列表 + 当前项目。
export function ProjectsView({ t, state, onSwitchProject }) {
  return (
    <section className="view on">
      <header className="pane-head"><span className="ttl">{t("rail.projects")}</span></header>
      <div className="c-list" style={{ padding: 20, maxWidth: 640 }}>
        {state.projects.map((p) => (
          <button key={p.id} className="c-item" onClick={() => onSwitchProject && onSwitchProject(p.root)}>
            <FolderKanban size={14} style={{ color: "var(--accent)" }} />
            <span className="tt">{p.name}{p.root === state.currentProject && <span className="cur">当前</span>}</span>
            <span className="s">{p.root}</span>
          </button>
        ))}
        {state.projects.length === 0 && <div style={{ color: "var(--text-mut)" }}>{t("rail.noProjects")}</div>}
      </div>
    </section>
  );
}

// 改动视图:listChanges 结果(description/状态)。
export function ChangesView({ t, state }) {
  const changes = state.changes || [];
  return (
    <section className="view on">
      <header className="pane-head"><span className="ttl">{t("rail.changes")}</span></header>
      <div className="c-list" style={{ padding: 20, maxWidth: 640 }}>
        {changes.map((c) => (
          <div key={c.id} className="c-item" style={{ cursor: "default" }}>
            <GitCompare size={14} style={{ color: "var(--accent)" }} />
            <span className="tt">{c.prompt || c.id}</span>
            <span className="s">{c.time || ""} · {c.files ? c.files.length : 0} 文件</span>
          </div>
        ))}
        {changes.length === 0 && <div style={{ color: "var(--text-mut)" }}>{t("changes.empty")}</div>}
      </div>
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
