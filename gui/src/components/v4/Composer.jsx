import React, { useRef } from "react";
import { Send, Paperclip, AtSign, Zap, Square } from "lucide-react";
import MetricsLine from "./MetricsLine.jsx";

// v1.4 悬浮胶囊输入区(.cz / .cz-in):首页与会话共用同一形态。
// 三段:文本域 → 工具行(附件 / 提及 / 权限档位 / 模型 / 发送)→ 状态行(MetricsLine)。
export default function Composer({
  t, draft, setDraft, onSend, onInterrupt, busy,
  model, autonomy, placeholder, flat = false, statusLine
}) {
  const ref = useRef(null);
  const send = () => {
    const text = String(draft || "").trim();
    if (!text) return;
    onSend(text);
  };
  const onKey = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };
  // 「附件 / 提及文件」在 kernel 侧尚无入口:此处只把提示符写进草稿,由用户续写路径。
  const insert = (token) => {
    setDraft(`${draft || ""}${draft && !draft.endsWith(" ") ? " " : ""}${token}`);
    if (ref.current) ref.current.focus();
  };

  return (
    <div className="cz" style={flat ? { padding: 0 } : undefined}>
      <div className="cz-in">
        <textarea ref={ref} className="cz-input" rows={2} placeholder={placeholder || t("chat.placeholder")}
          autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <div className="cz-row">
          <button type="button" className="cz-tool" title={t("chat.attach")} onClick={() => insert("@")}>
            <Paperclip size={14} />
          </button>
          <button type="button" className="cz-tool" title={t("chat.mention")} onClick={() => insert("@")}>
            <AtSign size={14} />
          </button>
          <span className="cz-tool" title={t("chat.autonomy")}><Zap size={14} /> {autonomy || t("chat.gated")}</span>
          <div className="spacer" />
          <span className="cz-mode">{model || "—"}</span>
          {busy
            ? <button type="button" className="cz-send" title={t("chat.interrupt")} onClick={onInterrupt}><Square size={12} /></button>
            : <button type="button" className="cz-send" title={t("chat.send")} onClick={send}><Send size={14} /></button>}
        </div>
        {statusLine && <MetricsLine {...statusLine} t={t} />}
      </div>
    </div>
  );
}
