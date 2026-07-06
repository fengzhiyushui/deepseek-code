// src/apps/tui/tui-app.js — TUI 组合根:kernel 接线、按键路由、重绘调度、终端态管理。
// 唯一的副作用汇聚点;所有依赖可注入,node:test 直接驱动。
import { createKernel } from "../../index.js";
import { buildKernelOptions } from "../kernel-options.js";
import { loadConfig } from "../../config.js";
import { color } from "../../theme.js";
import { seq } from "./ansi.js";
import { createKeyDecoder } from "./input.js";
import { makeT } from "./tui-i18n.js";
import { initialTuiState, reduce } from "./tui-state.js";
import { QUIET, eventToLines } from "./event-cards.js";
import { computeBottom, createPainter } from "./paint.js";
import { loadTuiPrefs } from "./prefs.js";

const CTRLC_WINDOW_MS = 3000;
const HISTORY_CAP = 20; // 与 kernel-runner appendHistory 同语义:10 轮

export function createTuiApp({
  root,
  input = process.stdin,
  output = process.stdout,
  kernel = null,
  createKernelImpl = createKernel,
  buildKernelOptionsImpl = buildKernelOptions,
  loadConfigImpl = loadConfig,
  now = Date.now,
  spinnerMs = 120
} = {}) {
  let state = initialTuiState({});
  let t = makeT(state.lang);
  const T = (key, vars) => t(key, vars);
  let history = [];
  let ownKernel = false;
  let subscription = null;
  let spinTimer = null;
  let paintQueued = null;
  let approvalResolve = null;
  let finishResolve = null;
  let modalHandler = null; // T13:config 等全接管视图的按键处理器
  const painter = createPainter({ write: (s) => output.write(s) });
  const columns = () => output.columns || 80;

  function apply(action) { state = reduce(state, action); }

  function dispatch(action) {
    apply(action);
    if (state.exit && finishResolve) { const r = finishResolve; finishResolve = null; r(); return; }
    schedulePaint();
  }

  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = setImmediate(() => {
      paintQueued = null;
      const append = state.pending;
      if (append.length) apply({ type: "flush", count: append.length });
      const bottom = computeBottom(state, T, columns());
      painter.paint({ append, ...bottom, bottom: bottom.lines });
    });
  }

  function pushLines(lines) { dispatch({ type: "push", lines }); }

  function refreshStatus() {
    if (!kernel) return;
    const st = kernel.runtime?.getState?.() || {};
    const usage = kernel.metrics?.getUsage?.() || {};
    dispatch({ type: "status", patch: {
      state: st.current || "idle",
      tokens: usage.total_tokens || 0,
      cacheRate: usage.cache_hit_rate || 0
    } });
  }

  function appendHistory(list, user, assistant) {
    return [
      ...list,
      { role: "user", content: user },
      { role: "assistant", content: assistant }
    ].slice(-HISTORY_CAP);
  }

  function subscribeKernel() {
    if (!kernel?.session?.subscribe) return;
    subscription = kernel.session.subscribe((event) => {
      refreshStatus();
      if (!event?.type || QUIET.has(event.type)) return;
      pushLines(eventToLines(event, T));
    });
  }

  function waitApproval(approval) {
    return new Promise((resolve) => {
      approvalResolve = (decision) => {
        approvalResolve = null;
        dispatch({ type: "approval", approval: null });
        resolve(decision);
      };
      dispatch({ type: "approval", approval });
    });
  }

  async function sendTurn(text) {
    dispatch({ type: "submit_local", line: ` ${color.cyan("❯")} ${text}` });
    if (!kernel) { pushLines([` ${color.yellow(T("banner.offline"))}`, ""]); return; }
    dispatch({ type: "busy", busy: true });
    try {
      let result = await kernel.agent.send(text, {
        autonomy: state.mode,
        history,
        stream: true,
        onDelta: (d) => dispatch({ type: "stream_delta", text: String(d) })
      });
      while (result && result.status === "awaiting_approval" && result.approval?.id) {
        const decision = await waitApproval(result.approval);
        result = await kernel.agent.approve(result.approval.id, decision);
      }
      if (result && result.status === "complete") {
        const content = result.content || "";
        const body = content ? content.split("\n").map((l) => ` ${l}`) : [];
        pushLines([` ${color.green("✓")} ${T("ev.done")}`, ...body, ""]);
        history = appendHistory(history, text, content);
      } else if (result) {
        pushLines([` ${color.red("✗")} ${T("ev.error")}: ${result.error || result.message || "?"}`, ""]);
      }
    } catch (error) {
      pushLines([` ${color.red("✗")} ${T("msg.sendFailed", { err: error?.message || String(error) })}`, ""]);
    } finally {
      dispatch({ type: "stream_clear" });
      dispatch({ type: "busy", busy: false });
      refreshStatus();
    }
  }

  // T9 会用命令注册表替换本实现;M4 阶段所有 /xxx 一律未知命令。
  async function handleSlash(text) {
    dispatch({ type: "submit_local", line: ` ${color.cyan("❯")} ${text}` });
    const name = text.slice(1).split(/\s+/)[0] || "";
    pushLines([` ${color.yellow(T("msg.unknownSlash", { name }))}`, ""]);
  }

  function submit() {
    const text = state.input.text.trim();
    if (!text || state.busy) return;
    if (text.startsWith("/")) { void handleSlash(text); return; }
    void sendTurn(text);
  }

  function onKey(ev) {
    if (ev.type === "ctrl_c") {
      if (now() - state.ctrlcAt <= CTRLC_WINDOW_MS) { dispatch({ type: "exit" }); return; }
      dispatch({ type: "ctrlc_mark", now: now() });
      dispatch({ type: "hint", text: T("hint.ctrlc") });
      return;
    }
    if (modalHandler) { modalHandler(ev); return; }
    if (state.approval) {
      if (ev.type === "char" && /^y$/i.test(ev.text)) approvalResolve?.("approve");
      else if ((ev.type === "char" && /^n$/i.test(ev.text)) || ev.type === "esc") approvalResolve?.("deny");
      return;
    }
    switch (ev.type) {
      case "char": dispatch({ type: "input_insert", text: ev.text }); return;
      case "paste": dispatch({ type: "input_insert", text: ev.text }); return;
      case "enter": submit(); return;
      case "backspace": dispatch({ type: "input_backspace" }); return;
      case "left": dispatch({ type: "input_left" }); return;
      case "right": dispatch({ type: "input_right" }); return;
      case "home": dispatch({ type: "input_home" }); return;
      case "end": dispatch({ type: "input_end" }); return;
      case "up": dispatch({ type: "input_hist_prev" }); return;
      case "down": dispatch({ type: "input_hist_next" }); return;
      case "esc": if (state.busy) dispatch({ type: "hint", text: T("hint.busy") }); return;
      default: return;
    }
  }

  async function run() {
    const prefs = await loadTuiPrefs(root).catch(() => ({}));
    if (prefs.lang === "en" || prefs.lang === "zh") {
      apply({ type: "lang", lang: prefs.lang });
      t = makeT(prefs.lang);
    }
    if (!kernel) {
      try {
        kernel = await createKernelImpl(root, await buildKernelOptionsImpl(root));
        ownKernel = true;
      } catch { kernel = null; }
    }
    try {
      const cfg = await loadConfigImpl(root, { allowMissingKey: true });
      apply({ type: "status", patch: { model: cfg?.model || "" } });
    } catch { /* 状态栏模型名留空 */ }

    input.setRawMode?.(true);
    input.resume?.();
    input.setEncoding?.("utf8");
    output.write(seq.pasteOn + "\n");
    const decoder = createKeyDecoder();
    let escTimer = null;
    const onData = (chunk) => {
      if (escTimer) { clearTimeout(escTimer); escTimer = null; }
      for (const ev of decoder.feed(String(chunk))) onKey(ev);
      if (decoder.hasPending()) {
        escTimer = setTimeout(() => {
          escTimer = null;
          for (const ev of decoder.flush()) onKey(ev);
        }, 40);
      }
    };
    input.on("data", onData);
    const onResize = () => schedulePaint();
    output.on?.("resize", onResize);
    spinTimer = setInterval(() => { if (state.busy) dispatch({ type: "spin" }); refreshStatus(); }, spinnerMs);

    subscribeKernel();
    pushLines([` ${color.cyan(T(kernel ? "banner.ready" : "banner.offline"))}`, ""]);
    refreshStatus();
    schedulePaint();

    await new Promise((resolve) => { finishResolve = resolve; });

    // 清理与终端态恢复(任何退出路径都走到这里)
    try {
      if (paintQueued) { clearImmediate(paintQueued); paintQueued = null; }
      if (escTimer) { clearTimeout(escTimer); escTimer = null; }
      clearInterval(spinTimer);
      subscription?.unsubscribe?.();
      input.removeListener("data", onData);
      output.removeListener?.("resize", onResize);
      painter.teardown();
      output.write(seq.pasteOff + seq.showCursor + seq.reset);
      input.setRawMode?.(false);
      input.pause?.();
    } finally {
      if (ownKernel && kernel?.dispose) await kernel.dispose().catch(() => {});
    }
  }

  return { run };
}
