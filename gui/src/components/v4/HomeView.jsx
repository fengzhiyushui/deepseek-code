import React, { useState } from "react";
import { Send, Zap } from "lucide-react";

// v1.4.0 欢迎首页:垂直居中、限宽、居中输入框;最近会话与快捷键收紧保留。
export default function HomeView({ t, state, actions, setView, onSwitchProject }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    actions.send(text);
    setView("chat");
  };

  return (
    <section className="view on">
      <div className="home">
        <div className="home-in">
          <div className="hello">
            <span className="lg">I</span>
            <h1>Inkstone</h1>
            <div className="sub">{t("home.tagline")}</div>
          </div>

          <div className="cz" style={{ padding: 0 }}>
            <div className="cz-in">
              <textarea className="cz-input" rows={2} placeholder={t("chat.placeholder")}
                value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
              <div className="cz-row">
                <button className="cz-tool" title={t("chat.autonomy")}><Zap size={13} /> {t("chat.gated")}</button>
                <span className="cz-mode">{state.config?.model || "—"}</span>
                <button className="cz-send" onClick={send}><Send size={14} /></button>
              </div>
            </div>
          </div>

          <div className="hint">
            <span className="hk"><b>Ctrl N</b> {t("home.hkNew")}</span>
            <span className="hk"><b>Ctrl/⌘ Enter</b> {t("home.hkSend")}</span>
          </div>

          {state.projects && state.projects.length > 0 && (
            <div className="c-list">
              <div className="cl-h">{t("home.recent")}</div>
              {state.projects.slice(0, 4).map((p) => (
                <button key={p.id} className="c-item" onClick={() => onSwitchProject && onSwitchProject(p.root)}>
                  <span className="tt">{p.name}</span>
                  <span className="s">{p.root}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
