// src/apps/tui/input.js — 原始输入(utf8 字符串)→ 按键事件。跨 chunk 缓冲不完整转义。
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

const CSI_FINAL = {
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end"
};
const CSI_TILDE = { 1: "home", 4: "end", 7: "home", 8: "end" };

export function createKeyDecoder() {
  let pending = "";   // 不完整的转义序列尾巴
  let pasting = false;
  let pasteBuf = "";

  function feed(chunk) {
    let data = pending + String(chunk || "");
    pending = "";
    const events = [];
    let chars = "";
    const flushChars = () => {
      if (chars) { events.push({ type: "char", text: chars }); chars = ""; }
    };

    let i = 0;
    while (i < data.length) {
      if (pasting) {
        const end = data.indexOf(PASTE_END, i);
        if (end === -1) {
          // 结束符可能被截断在 chunk 边界:保留可疑尾巴
          const keep = Math.max(i, data.length - (PASTE_END.length - 1));
          pasteBuf += data.slice(i, keep);
          pending = data.slice(keep);
          return events;
        }
        pasteBuf += data.slice(i, end);
        events.push({ type: "paste", text: pasteBuf });
        pasteBuf = "";
        pasting = false;
        i = end + PASTE_END.length;
        continue;
      }
      const ch = data[i];
      if (ch === "\x1b") {
        flushChars();
        if (data.startsWith(PASTE_START, i)) { pasting = true; i += PASTE_START.length; continue; }
        const next = data[i + 1];
        if (next === undefined) {
          // 可能是被截断的序列开头,也可能是孤立 ESC:留到下一次 feed 判定
          pending = data.slice(i);
          return events;
        }
        if (next === "[") {
          // CSI: \x1b [ 参数字节* 终止字节(@-~)
          let j = i + 2;
          while (j < data.length && !(data[j] >= "@" && data[j] <= "~")) j += 1;
          if (j >= data.length) {
            if (data.startsWith(PASTE_START.slice(0, data.length - i), i)) { pending = data.slice(i); return events; }
            pending = data.slice(i); return events;
          }
          const params = data.slice(i + 2, j);
          const final = data[j];
          if (final === "~" && CSI_TILDE[params]) events.push({ type: CSI_TILDE[params] });
          else if (CSI_FINAL[final] && (params === "" || params === "1")) events.push({ type: CSI_FINAL[final] });
          // 其余 CSI(含鼠标/PgUp 等)静默丢弃
          i = j + 1;
          continue;
        }
        if (next === "O" && CSI_FINAL[data[i + 2]]) { // SS3 变体
          events.push({ type: CSI_FINAL[data[i + 2]] });
          i += 3;
          continue;
        }
        events.push({ type: "esc" });
        i += 1;
        continue;
      }
      if (ch === "\r" || ch === "\n") { flushChars(); events.push({ type: "enter" }); i += 1; continue; }
      if (ch === "\x7f" || ch === "\x08") { flushChars(); events.push({ type: "backspace" }); i += 1; continue; }
      if (ch === "\t") { flushChars(); events.push({ type: "tab" }); i += 1; continue; }
      if (ch === "\x03") { flushChars(); events.push({ type: "ctrl_c" }); i += 1; continue; }
      if (ch < " ") { i += 1; continue; } // 其余控制字符丢弃
      chars += ch;
      i += 1;
    }
    flushChars();
    return events;
  }

  return { feed };
}
