import React, { useState } from "react";
import Icon from "./Icons.jsx";
import { deriveAgentCards } from "../state/agent-cards.js";

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

function ToolStatus({ status }) {
  if (status === "ok") return <span className="r" style={{ color: "var(--green)" }}><Icon name="check" size={13} /></span>;
  if (status === "error") return <span className="r" style={{ color: "var(--red)" }}>✕</span>;
  return <span className="r"><span className="spin" /></span>;
}

function LiveCards({ t, cards, onOpenChange }) {
  return cards.map((c, i) => {
    if (c.kind === "plan") {
      return (
        <div key={i} className="card">
          <div className="ch"><Icon name="plan" size={14} style={{ color: "var(--accent)" }} /> {t("agent.plan")} · {c.subtasks} {t("agent.steps")}{c.round ? ` · #${c.round}` : ""}</div>
        </div>
      );
    }
    if (c.kind === "tool") {
      return (
        <div key={i} className="card">
          <div className="ch"><Icon name="edit" size={14} style={{ color: "var(--fn)" }} /> {c.tool}<ToolStatus status={c.status} /></div>
        </div>
      );
    }
    if (c.kind === "diff") {
      const clickable = Boolean(c.changeId && onOpenChange);
      return (
        <div key={i} className="card">
          <div className={`ch ${clickable ? "clickable" : ""}`}
            role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onOpenChange(c.changeId, c.path) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === "Enter") onOpenChange(c.changeId, c.path); } : undefined}>
            <Icon name="edit" size={14} style={{ color: "var(--fn)" }} />
            <span className="name" style={{ color: "var(--text-mut)" }}>
              {c.path}{c.fileCount > 1 ? ` (+${c.fileCount - 1})` : ""}
            </span>
            {!c.applied && <span className="r" style={{ color: "var(--text-mut)" }}>preview</span>}
          </div>
        </div>
      );
    }
    if (c.kind === "test") {
      return (
        <div key={i} className="card">
          <div className="ch"><Icon name="check" size={14} style={{ color: c.pass ? "var(--green)" : "var(--red)" }} /> {t("agent.runTests")}
            <span className="r" style={{ color: c.pass ? "var(--green)" : "var(--red)" }}>{c.pass ? t("agent.passed") : "✕"}</span></div>
        </div>
      );
    }
    return null;
  });
}

// Illustrative preview shown only when the panel is truly idle (§6.3, clearly labelled).
function SamplePreview({ t }) {
  return (
    <div role="note" aria-label={t("placeholder.badge")}>
      <div style={{ color: "var(--text-mut)", fontSize: 11, margin: "2px 0 8px" }}>{t("placeholder.badge")}</div>
      <div className="card">
        <div className="ch"><Icon name="plan" size={14} style={{ color: "var(--accent)" }} /> {t("agent.plan")} · 3 {t("agent.steps")}</div>
        <div className="cb">
          <div className="plan"><div className="step done"><span className="box">✓</span> …</div><div className="step run"><span className="box"><span className="spin" /></span> …</div></div>
        </div>
      </div>
    </div>
  );
}

export default function AgentPanel({ t, state, actions }) {
  const [draft, setDraft] = useState("");
  const submit = () => { const s = draft.trim(); if (!s) return; actions.send(s); setDraft(""); };
  const cards = deriveAgentCards(state.activity);
  const hasMsgs = state.messages.length > 0;
  const idle = !hasMsgs && cards.length === 0;

  return (
    <section className="agent" aria-label={t("agent")}>
      <div className="ahead">
        <span className="ttl"><Icon name="agent" size={15} style={{ color: "var(--accent)" }} /> {t("agent").toUpperCase()}</span>
        <span className="badge">deepseek-v4-pro</span>
      </div>
      <div className="athread" role="log" aria-live="polite" aria-label={t("agent")}>
        <Approval t={t} approval={state.approval} onApprove={actions.approve} />
        {hasMsgs && state.messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "msg user" : "card"} style={m.role === "user" ? {} : { padding: "8px 10px" }}>
            {m.role !== "user" && <div style={{ color: "var(--text-mut)", fontSize: 11, marginBottom: 2 }}>{m.role || "agent"}</div>}
            <div>{m.text || m.content || ""}</div>
          </div>
        ))}
        {cards.length > 0 && <LiveCards t={t} cards={cards} onOpenChange={actions.openChange} />}
        {idle && (<><div className="empty" style={{ marginBottom: 8 }}>{t("agent.ask")}</div><SamplePreview t={t} /></>)}
      </div>
      <div className="acomposer">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
          aria-label={t("composer.placeholder")} placeholder={t("composer.placeholder")}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }} />
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
