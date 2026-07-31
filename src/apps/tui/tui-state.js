// src/apps/tui/tui-state.js — TUI 纯 reducer(不可变)+ 状态栏派生。IO 一概不进此文件。
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const HISTORY_CAP = 100; // 本地输入历史条数上限

export function initialTuiState({ lang = "zh", mode = "gated", theme = "sumi", shell = "pwsh" } = {}) {
  return {
    lang,
    mode,
    theme,
    shell,
    screen: "home", // v1.4.0:home 首页 / chat 会话
    busy: false,
    spin: 0,
    exit: false,
    input: { text: "", cursor: 0, history: [], hi: -1, saved: "" },
    stream: "",
    approval: null,
    menu: null,
    overlay: null,
    pending: [],
    hint: "",
    status: { state: "idle", model: "", tokens: 0, cacheRate: 0 },
    ctrlcAt: 0
  };
}

function chars(text) { return Array.from(text); }

export function reduce(state, action = {}) {
  switch (action.type) {
    case "input_insert": {
      const cs = chars(state.input.text);
      const add = chars(String(action.text || ""));
      cs.splice(state.input.cursor, 0, ...add);
      return withInput(state, { text: cs.join(""), cursor: state.input.cursor + add.length });
    }
    case "input_backspace": {
      if (state.input.cursor === 0) return state;
      const cs = chars(state.input.text);
      cs.splice(state.input.cursor - 1, 1);
      return withInput(state, { text: cs.join(""), cursor: state.input.cursor - 1 });
    }
    case "input_left": return withInput(state, { cursor: Math.max(0, state.input.cursor - 1) });
    case "input_right": return withInput(state, { cursor: Math.min(chars(state.input.text).length, state.input.cursor + 1) });
    case "input_home": return withInput(state, { cursor: 0 });
    case "input_end": return withInput(state, { cursor: chars(state.input.text).length });
    case "input_set": return withInput(state, { text: action.text, cursor: chars(action.text).length });
    case "input_hist_prev": {
      const { history, hi, text, saved } = state.input;
      if (!history.length) return state;
      const next = hi === -1 ? history.length - 1 : Math.max(0, hi - 1);
      const keepSaved = hi === -1 ? text : saved;
      return withInput(state, { text: history[next], cursor: chars(history[next]).length, hi: next, saved: keepSaved });
    }
    case "input_hist_next": {
      const { history, hi, saved } = state.input;
      if (hi === -1) return state;
      if (hi >= history.length - 1) return withInput(state, { text: saved, cursor: chars(saved).length, hi: -1, saved: "" });
      const next = hi + 1;
      return withInput(state, { text: history[next], cursor: chars(history[next]).length, hi: next });
    }
    case "submit_local": {
      const entry = state.input.text;
      const history = entry ? [...state.input.history, entry].slice(-HISTORY_CAP) : state.input.history;
      return {
        ...state,
        pending: [...state.pending, action.line, ""],
        input: { text: "", cursor: 0, history, hi: -1, saved: "" }
      };
    }
    case "push": return { ...state, pending: [...state.pending, ...action.lines] };
    case "flush": return { ...state, pending: state.pending.slice(action.count) };
    case "stream_delta": return { ...state, stream: state.stream + String(action.text || "") };
    case "stream_clear": return { ...state, stream: "" };
    case "busy": return { ...state, busy: Boolean(action.busy), hint: action.busy ? state.hint : "" };
    case "spin": return { ...state, spin: (state.spin + 1) % SPINNER.length };
    case "approval": return { ...state, approval: action.approval || null };
    case "menu": return { ...state, menu: action.menu || null };
    case "menu_move": {
      if (!state.menu || !state.menu.items.length) return state;
      const n = state.menu.items.length;
      const index = ((state.menu.index + action.delta) % n + n) % n;
      return { ...state, menu: { ...state.menu, index } };
    }
    case "overlay": return { ...state, overlay: action.overlay || null };
    case "mode": return { ...state, mode: action.mode };
    case "lang": return { ...state, lang: action.lang };
    case "theme_set": return { ...state, theme: action.theme };
    case "shell_set": return { ...state, shell: action.shell };
    case "screen_set": return { ...state, screen: action.screen };
    case "hint": return { ...state, hint: String(action.text || "") };
    case "status": {
      const patch = action.patch || {};
      let same = true;
      for (const [key, value] of Object.entries(patch)) {
        if (state.status[key] !== value) { same = false; break; }
      }
      if (same) return state; // 空转刷新不触发重绘
      return { ...state, status: { ...state.status, ...patch } };
    }
    case "ctrlc_mark": return { ...state, ctrlcAt: action.now };
    case "exit": return { ...state, exit: true };
    default: return state;
  }
}

function withInput(state, patch) {
  return { ...state, input: { ...state.input, ...patch } };
}

export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(1)}k`;
  return `${(v / 1_000_000).toFixed(1)}m`;
}

export function statusLine(state, t) {
  const runState = state.busy ? SPINNER[state.spin] : (state.status.state || "idle");
  const parts = [
    state.mode,
    state.status.model || "-",
    runState,
    `tokens ${formatTokens(state.status.tokens)}`,
    `cache ${Math.round((state.status.cacheRate || 0) * 100)}%`,
    state.shell ? `sh:${state.shell}` : "",
    state.theme ? `theme:${state.theme}` : "", // v1.4.6:与设计稿的 TUI 状态行一致
    t("status.lang")
  ].filter(Boolean);
  const line = parts.join(" · ");
  return line;
}
