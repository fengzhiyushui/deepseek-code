import React from "react";
import Icon from "./Icons.jsx";
import { statusSummary, metricsFromUsage } from "../state/workbench-state.js";
import { derivePanels } from "../state/panels-derive.js";

const LANG_LABEL = {
  javascript: "JavaScript", typescript: "TypeScript", python: "Python", json: "JSON",
  markdown: "Markdown", css: "CSS", html: "HTML", yaml: "YAML", shell: "Shell", plaintext: "Plain Text"
};

export default function StatusBar({ t, state, offline }) {
  const s = statusSummary(state);
  const m = state.metrics || metricsFromUsage({});
  const { problems } = derivePanels(state.activity, state.errors);
  const active = (state.openFiles || []).find((f) => f.path === state.activeFile) || null;
  const langLabel = active ? (LANG_LABEL[active.language] || active.language || "Plain Text") : "—";
  const cur = state.cursor || { line: 1, column: 1 };
  const model = state.config?.model;

  return (
    <footer className="status" role="contentinfo">
      <button type="button" className="seg" title={s.branch}><Icon name="branch" size={13} /> {s.branch}</button>
      <div className="seg" title={t("status.problems")}><Icon name="error" size={13} /> {problems.length} <Icon name="warn" size={13} /> 0</div>
      <div className="seg">{m.tokens} · {m.cacheRate} · {m.latency}</div>
      {model && <div className="seg" title="model"><Icon name="agent" size={13} /> {model}</div>}
      {offline && <div className="seg" style={{ color: "#ffd27a" }}>{t("offline")}</div>}
      <div className="grow" />
      <div className="seg">{active ? `Ln ${cur.line}, Col ${cur.column}` : "Ln —, Col —"}</div>
      <div className="seg">{t("status.spaces")}: 2</div>
      <div className="seg">UTF-8</div>
      <div className="seg">LF</div>
      <div className="seg">{langLabel}</div>
      <div className="seg" aria-hidden="true"><Icon name="bell" size={13} /></div>
    </footer>
  );
}
