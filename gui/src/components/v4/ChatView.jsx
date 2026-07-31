import React, { useMemo, useState } from "react";
import { deriveAgentCards } from "../../state/agent-cards.js";
import MetricsLine from "./MetricsLine.jsx";
import { Send, Paperclip, AtSign, Zap } from "lucide-react";

function EventCard({ card, t }) {
  if (card.kind === "plan") {
    return (
      <div className="ev">
        <div className="ev-h"><span className="car">▾</span><span style={{ color: "var(--accent)" }}>▸</span> {t("ev.plan")} · {card.subtasks} {t("ev.steps")}</div>
        <div className="ev-b"><span className="mini run">{t("ev.inProgress")} {card.round ? `${card.round}/` : ""}{card.subtasks}</span></div>
      </div>
    );
  }
  if (card.kind === "tool") {
    return (
      <div className="ev">
        <div className="ev-h"><span className={`mini ${card.status === "error" ? "err" : card.status === "ok" ? "ok" : "run"}`}>{card.status === "ok" ? t("ev.toolOk") : card.status === "error" ? t("ev.error") : "…"}</span> {card.tool}</div>
      </div>
    );
  }
  if (card.kind === "diff") {
    return (
      <div className="ev">
        <div className="ev-h"><span className="mini ok">±</span> {card.path || t("ev.diff")}{card.fileCount > 1 ? ` (+${card.fileCount - 1})` : ""}</div>
      </div>
    );
  }
  if (card.kind === "approval") {
    return <div className="ev"><div className="ev-h"><span className="mini warn">!</span> {t("ev.approval")}</div></div>;
  }
  return <div className="ev"><div className="ev-h"><span className="mini">{card.kind}</span></div></div>;
}

export default function ChatView({ t, state, actions, kernel, metrics }) {
  const [draft, setDraft] = useState("");
  const cards = useMemo(() => deriveAgentCards(state.activity), [state.activity]);
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    actions.send(text);
  };
  const onKey = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };

  return (
    <section className="view on">
      <header className="pane-head">
        <span className="ttl">{t("chat.title")}</span>
        <span className="sub">{state.currentProject || ""}</span>
        <div className="spacer" />
        <span className="seg click"><Zap size={12} /> {state.runtime?.current || "idle"}</span>
        <span className="seg acc click">{state.config?.model || "—"}</span>
      </header>

      <div className="stream">
        <div className="stream-in">
          {state.messages.map((m, i) => (
            m.role === "user"
              ? <div key={i} className="u-msg"><div className="bb">{m.text || m.content}</div></div>
              : <div key={i} className="a-msg">
                  <span className="mk">I</span>
                  <div className="tx">
                    {m.text || m.content}
                    <div className="mt">{state.config?.model || ""}</div>
                  </div>
                </div>
          ))}
          {cards.map((card, i) => <EventCard key={i} card={card} t={t} />)}
          {state.messages.length === 0 && cards.length === 0 && (
            <div className="empty" style={{ color: "var(--text-mut)", padding: "40px 0", textAlign: "center" }}>{t("chat.empty")}</div>
          )}
        </div>
      </div>

      <div className="cz">
        <div className="cz-in">
          <textarea className="cz-input" rows={2} placeholder={t("chat.placeholder")}
            value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
          <div className="cz-row">
            <button className="cz-tool" title={t("chat.attach")}><Paperclip size={13} /></button>
            <button className="cz-tool" title={t("chat.mention")}><AtSign size={13} /></button>
            <button className="cz-tool" title={t("chat.autonomy")}><Zap size={13} /> {t("chat.gated")}</button>
            <span className="cz-mode">{state.config?.model || "—"}</span>
            <button className="cz-send" title={t("chat.send")} onClick={send}><Send size={14} /></button>
          </div>
          <MetricsLine t={t} display={state.statusDisplay} metrics={metrics} />
        </div>
      </div>
    </section>
  );
}
