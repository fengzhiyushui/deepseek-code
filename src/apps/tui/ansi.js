// src/apps/tui/ansi.js — VT 序列构造与显示宽度(零依赖,纯函数)。
export const seq = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  pasteOn: "\x1b[?2004h",
  pasteOff: "\x1b[?2004l",
  clearDown: "\x1b[J",
  clearLine: "\x1b[2K",
  reset: "\x1b[0m",
  up: (n) => (n > 0 ? `\x1b[${n}A` : ""),
  down: (n) => (n > 0 ? `\x1b[${n}B` : ""),
  col: (n) => `\x1b[${n}G`
};

// CJK/全角近似:这些区间记 2 列,其余 1 列(控制字符不应出现在渲染文本里)。
function charWidth(code) {
  if (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK 部首~Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul 音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
    (code >= 0xff00 && code <= 0xff60) || // 全角形式
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)  // CJK 扩展 B+
  ) return 2;
  return 1;
}

export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text || "")) width += charWidth(ch.codePointAt(0));
  return width;
}

export function truncateToWidth(text, max) {
  let width = 0;
  let out = "";
  for (const ch of String(text || "")) {
    const w = charWidth(ch.codePointAt(0));
    if (width + w > max) break;
    width += w;
    out += ch;
  }
  return out;
}

export function padToWidth(text, width) {
  const value = String(text || "");
  const pad = width - displayWidth(value);
  return pad > 0 ? value + " ".repeat(pad) : value;
}
