import React from "react";
import Icon from "./Icons.jsx";
import { statusSummary, metricsFromUsage } from "../state/workbench-state.js";

export default function StatusBar({ t, state, offline }) {
  const s = statusSummary(state);
  const m = state.metrics || metricsFromUsage({});
  const problems = (state.errors && state.errors.length) || 0;
  return (
    <footer className="status" role="contentinfo">
      <button type="button" className="seg" title={s.branch}><Icon name="branch" size={13} /> {s.branch}</button>
      <div className="seg"><Icon name="error" size={13} /> {problems} <Icon name="warn" size={13} /> 0</div>
      <div className="seg">{m.tokens} · {m.cacheRate} · {m.latency}</div>
      {offline && <div className="seg" style={{ color: "#ffd27a" }}>{t("offline")}</div>}
      <div className="grow" />
      <div className="seg">Ln 7, Col 41</div>
      <div className="seg">{t("status.spaces")}: 2</div>
      <div className="seg">UTF-8</div>
      <div className="seg">LF</div>
      <div className="seg">JavaScript</div>
      <div className="seg" aria-hidden="true"><Icon name="bell" size={13} /></div>
    </footer>
  );
}
