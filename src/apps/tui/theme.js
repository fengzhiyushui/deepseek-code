// src/apps/tui/theme.js — TUI 主题色:从 theme-palette.js 的 xterm-256 色号构造 ANSI 颜色集。
// 与 src/theme.js 的 color 同键(cyan/green/red/yellow/dim/bold/inverse),可整文件替换导入;
// setTuiTheme 切换后,后续所有 tc.* 调用即时取新主题色(模块级 let 动态读取)。
import { TUI_THEMES, DEFAULT_TUI_THEME } from "./theme-palette.js";

let currentId = DEFAULT_TUI_THEME;
const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const fg = (idx) => (supportsColor ? `\x1b[38;5;${idx}m` : "");
const wrap = (open) => (value) => (supportsColor ? `${open}${value}\x1b[0m` : value);

function col(key) {
  return (value) => wrap(fg((TUI_THEMES[currentId] || TUI_THEMES[DEFAULT_TUI_THEME])[key]))(value);
}

export function setTuiTheme(id) {
  if (TUI_THEMES[id]) currentId = id;
}
export function tuiThemeId() {
  return currentId;
}
export function tuiThemeList() {
  return Object.keys(TUI_THEMES).map((id) => ({ id, name: TUI_THEMES[id].name }));
}

export const tc = {
  cyan: col("accent"),
  green: col("ok"),
  red: col("err"),
  yellow: col("warn"),
  dim: col("mut"),
  bold: (v) => wrap("\x1b[1m")(v),
  inverse: (v) => wrap("\x1b[7m")(v)
};
