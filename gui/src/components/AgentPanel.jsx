import React, { useState } from "react";
import Icon from "./Icons.jsx";

function Approval({ t, approval, onApprove }) {
  if (!approval) return null;
  return (
    <div className="approval" role="alertdialog" aria-live="assertive" aria-label={t("approval.required")}>
      <div><strong>{t("approval.required")}</strong> — <span className="name">{approval.summary || approval.id}</span></div>
      <div className="row">
        <button type="button" className="ap" onClick={() => onApprove(approval.id, "approve")} aria-label={t("approval.approve")}>{t("approval.approve")}</button>
        <button type="button" className="dn" onClick={() => onApprove(approval.id, "deny")} aria-label={t("approval.deny") + " — rejects the pending action"}>{t("approval.deny")}</button>
      </div>
    </div>
  );
}

// Illustrative preview of agent activity, shown only when idle and clearly labelled as sample (§6.3).
function SamplePreview({ t }) {
  return (
    <div role="note" aria-label={t("placeholder.badge")}>
      <div style={{ color: "var(--text-mut)", fontSize: 11, margin: "2px 0 8px" }}>{t("placeholder.badge")}</div>
      <div className="msg user" style={{ marginBottom: 12 }}>给 task-router 的模糊档接上模型判复杂度,并补全测试。</div>
      <div className="card plan" style={{ marginBottom: 12 }}>
        <div className="ch"><Icon name="plan" size={14} style={{ color: "var(--accent)" }} /> {t("agent.plan")} · 4 {t("agent.steps")}</div>
        <div className="cb">
          <div className="step done"><span className="box">✓</span> 读取 task-router.js 与现有测试</div>
          <div className="step done"><span className="box">✓</span> 设计三档 + 模型兜底</div>
          <div className="step run"><span className="box"><span className="spin" /></span> 写 router-scoring 纯函数 + 单测</div>
          <div className="step todo"><span className="box" /> 接线 index.js + 回归</div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="ch"><Icon name="edit" size={14} style={{ color: "var(--fn)" }} /> {t("agent.editing")} <span style={{ color: "var(--text-mut)" }}>router-scoring.js</span></div>
        <div className="cb diff">
          <div className="add">+ export function classifyBand(score, T) {"{"}</div>
          <div className="add">+   return score {"<="} 0 ? "simple" : score {">="} T ? "complex" : "ambiguous";</div>
          <div className="add">+ {"}"}</div>
        </div>
      </div>
      <div className="card">
        <div className="ch"><Icon name="check" size={14} style={{ color: "var(--green)" }} /> {t("agent.runTests")} <span className="r" style={{ color: "var(--green)" }}>{t("agent.passed")} · 10/10</span></div>
      </div>
    </div>
  );
}

export default function AgentPanel({ t, state, actions }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const s = draft.trim(); if (!s) return; actions.send(s); setDraft(""); };
  const hasMsgs = state.messages.length > 0;
  return (
    <section className="agent" aria-label={t("agent")}>
      <div className="ahead">
        <span className="ttl"><Icon name="agent" size={15} style={{ color: "var(--accent)" }} /> {t("agent").toUpperCase()}</span>
        <span className="badge">deepseek-v4-pro</span>
      </div>
      <div className="athread" role="log" aria-live="polite" aria-label={t("agent")}>
        <Approval t={t} approval={state.approval} onApprove={actions.approve} />
        {hasMsgs
          ? state.messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "msg user" : "card"} style={m.role === "user" ? {} : { padding: "8px 10px" }}>
                {m.role !== "user" && <div style={{ color: "var(--text-mut)", fontSize: 11, marginBottom: 2 }}>{m.role || "agent"}</div>}
                <div>{m.text || m.content || ""}</div>
              </div>
            ))
          : (<><div className="empty" style={{ marginBottom: 8 }}>{t("agent.ask")}</div><SamplePreview t={t} /></>)}
      </div>
      <div className="acomposer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t("composer.placeholder")}
          placeholder={t("composer.placeholder")}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        />
        <div className="row">
          <span className="mode">{t("composer.mode")}</span>
          <span>
            <button type="button" className="send" onClick={submit} aria-label={t("composer.send")}>{t("composer.send")} ⏎</button>
            <button type="button" className="ghost" onClick={() => actions.interrupt()} aria-label={t("composer.interrupt")}>{t("composer.interrupt")}</button>
          </span>
        </div>
      </div>
    </section>
  );
}
