import React, { useState } from "react";
import { Button, TextArea } from "@douyinfe/semi-ui";

function ApprovalBanner({ approval, onApprove }) {
  if (!approval) return null;
  return (
    <div className="approval" role="alertdialog" aria-live="assertive" aria-label="approval required">
      <div>
        <strong>Approval required</strong> — <span className="ellipsis">{approval.summary || approval.id}</span>
      </div>
      <div className="row">
        <Button size="small" theme="solid" onClick={() => onApprove(approval.id, "approve")} aria-label="approve">
          Approve
        </Button>
        <Button size="small" type="danger" onClick={() => onApprove(approval.id, "deny")} aria-label="deny (rejects the pending action)">
          Deny
        </Button>
      </div>
    </div>
  );
}

export default function ChatPanel({ state, actions }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    actions.send(t);
    setDraft("");
  };
  return (
    <section className="panel chatpanel" aria-label="agent panel">
      <div className="section-title">Agent</div>
      <ApprovalBanner approval={state.approval} onApprove={actions.approve} />
      <div className="chat-thread" role="log" aria-label="conversation" aria-live="polite">
        {state.messages.length === 0 && (
          <div style={{ color: "var(--ide-muted)" }}>Ask DeepSeek Code anything about this project.</div>
        )}
        {state.messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role === "user" ? "user" : ""}`}>
            <div className="role">{m.role || "agent"}</div>
            <div className="text">{m.text || m.content || ""}</div>
          </div>
        ))}
      </div>
      <div className="chat-composer">
        <TextArea
          value={draft}
          onChange={setDraft}
          autosize
          rows={2}
          aria-label="message composer"
          placeholder="Message DeepSeek Code…  (Cmd/Ctrl+Enter to send)"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
        />
        <div className="row" style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button theme="solid" onClick={submit} aria-label="send message">Send</Button>
          <Button type="tertiary" onClick={() => actions.interrupt()} aria-label="interrupt agent">Interrupt</Button>
        </div>
      </div>
    </section>
  );
}
