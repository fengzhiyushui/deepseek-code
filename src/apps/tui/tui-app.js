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
import { loadTuiPrefs, saveTuiPrefs } from "./prefs.js";
import { SLASH_COMMANDS, filterCommands, parseSlash } from "./slash.js";
import { showDiff } from "../../git.js";
import { listChanges, formatChange } from "../../changes.js";
import path from "node:path";
import { createApiProfiles, maskKey } from "../api-profiles.js";
import { fetchModelIds } from "../model-catalog.js";
import { testDeepSeekConnection } from "../../provider.js";
import { configureProject } from "../../config.js";
import { CONFIG_ACTIONS, CONFIG_FIELDS, initialConfigState, reduceConfig, renderConfigLines } from "./config-flow.js";

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
  showDiffImpl = showDiff,
  listChangesImpl = listChanges,
  formatChangeImpl = formatChange,
  apiProfilesImpl = null,
  fetchModelIdsImpl = fetchModelIds,
  testConnectionImpl = testDeepSeekConnection,
  configureProjectImpl = configureProject,
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
    const prev = state;
    apply(action);
    if (state === prev) return; // reducer 判定无变化(如空转 status)则不重绘
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

  // ── /config:共享 api-profiles 存储 + config-flow 状态机的 IO 接线 ──
  const profilesStore = apiProfilesImpl || createApiProfiles({ dir: path.join(root, ".deepseek-code") });
  let cfgState = null;

  function syncConfigOverlay() {
    if (!cfgState) { modalHandler = null; dispatch({ type: "overlay", overlay: null }); return; }
    dispatch({ type: "overlay", overlay: renderConfigLines(cfgState, T, maskKey, columns()) });
  }

  function cfgDispatch(action) { cfgState = reduceConfig(cfgState, action); syncConfigOverlay(); }

  async function refreshCfgProfiles() {
    const profiles = await profilesStore.list();
    const active = await profilesStore.getActive();
    cfgDispatch({ type: "cfg_profiles", profiles, activeId: active ? active.id : null });
  }

  async function activateProfile(profile) {
    try {
      const prof = await profilesStore.activate(profile.id);
      await configureProjectImpl(root, { apiKey: prof.apiKey, baseUrl: prof.baseUrl, ...(prof.model ? { model: prof.model } : {}) });
      subscription?.unsubscribe?.();
      if (ownKernel && kernel?.dispose) await kernel.dispose().catch(() => {});
      try {
        kernel = await createKernelImpl(root, await buildKernelOptionsImpl(root));
        ownKernel = true;
      } catch { kernel = null; }
      subscribeKernel();
      dispatch({ type: "status", patch: { model: prof.model || "" } });
      await refreshCfgProfiles();
      cfgDispatch({ type: "cfg_notice", notice: T("cfg.activated", { name: prof.name || prof.id }) });
    } catch (e) { cfgDispatch({ type: "cfg_error", error: `${e?.message || e}` }); }
  }

  async function runConfigAction(name, profile) {
    if (name === "activate") { await activateProfile(profile); return; }
    if (name === "edit") { cfgDispatch({ type: "cfg_draft_edit", profile }); return; }
    if (name === "models") {
      cfgDispatch({ type: "cfg_draft_edit", profile });
      try {
        const models = await fetchModelIdsImpl({ baseUrl: profile.baseUrl, apiKey: profile.apiKey });
        if (!models.length) { cfgDispatch({ type: "cfg_error", error: T("cfg.modelsEmpty") }); return; }
        cfgDispatch({ type: "cfg_models", models });
      } catch (e) { cfgDispatch({ type: "cfg_error", error: T("cfg.modelsFail", { err: e?.message || e }) }); }
      return;
    }
    if (name === "test") {
      try {
        await testConnectionImpl({ apiKey: profile.apiKey, baseUrl: profile.baseUrl });
        cfgDispatch({ type: "cfg_notice", notice: T("cfg.testOk") });
      } catch (e) { cfgDispatch({ type: "cfg_error", error: T("cfg.testFail", { err: e?.message || e }) }); }
      return;
    }
    if (name === "delete") {
      await profilesStore.remove(profile.id);
      await refreshCfgProfiles();
      cfgDispatch({ type: "cfg_notice", notice: T("cfg.deleted") });
    }
  }

  async function saveDraft() {
    const draft = cfgState.draft;
    const saved = await profilesStore.save(draft);
    await refreshCfgProfiles();
    cfgDispatch({ type: "cfg_notice", notice: T("cfg.saved", { name: saved.name || saved.id }) });
  }

  function configKeys(ev) {
    if (!cfgState) return;
    if (ev.type === "esc") {
      if (cfgState.view === "list") { cfgState = null; syncConfigOverlay(); return; }
      if (cfgState.view === "models") { cfgDispatch({ type: "cfg_view", view: "edit" }); return; }
      cfgDispatch({ type: "cfg_view", view: "list" });
      return;
    }
    if (ev.type === "up") { cfgDispatch({ type: "cfg_move", delta: -1 }); return; }
    if (ev.type === "down") { cfgDispatch({ type: "cfg_move", delta: 1 }); return; }
    if (ev.type === "char" || ev.type === "paste") {
      if (cfgState.view === "edit") cfgDispatch({ type: "cfg_field_input", text: ev.text });
      return;
    }
    if (ev.type === "backspace") {
      if (cfgState.view === "edit") cfgDispatch({ type: "cfg_field_backspace" });
      return;
    }
    if (ev.type !== "enter") return;
    if (cfgState.view === "list") {
      if (cfgState.index === cfgState.profiles.length) { cfgDispatch({ type: "cfg_draft_new" }); return; }
      cfgDispatch({ type: "cfg_view", view: "actions" });
      return;
    }
    if (cfgState.view === "actions") {
      const profile = cfgState.profiles[cfgState.index];
      void runConfigAction(CONFIG_ACTIONS[cfgState.actionIndex], profile);
      return;
    }
    if (cfgState.view === "edit") {
      if (cfgState.field < CONFIG_FIELDS.length - 1) { cfgDispatch({ type: "cfg_field_next" }); return; }
      void saveDraft();
      return;
    }
    if (cfgState.view === "models") { cfgDispatch({ type: "cfg_model_pick" }); return; }
  }

  const diffLine = (l) =>
    l.startsWith("+") ? ` ${color.green(l)}` : l.startsWith("-") ? ` ${color.red(l)}` : ` ${color.dim(l)}`;

  const SLASH_HANDLERS = {
    help: async () => {
      pushLines([...activeCommands().map((c) => `  /${c.name.padEnd(9)} ${color.dim(T(c.descKey))}`), ""]);
    },
    config: async () => {
      cfgState = initialConfigState({ profiles: await profilesStore.list(), activeId: (await profilesStore.getActive())?.id || null });
      modalHandler = configKeys;
      syncConfigOverlay();
    },
    lang: async (arg) => {
      const next = arg === "en" || arg === "zh" ? arg : (state.lang === "zh" ? "en" : "zh");
      t = makeT(next);
      dispatch({ type: "lang", lang: next });
      try {
        const prefs = await loadTuiPrefs(root);
        await saveTuiPrefs(root, { ...prefs, lang: next });
      } catch { /* 持久化失败不阻塞切换 */ }
      pushLines([` ${T("msg.langSet")}`, ""]);
    },
    mode: async (arg) => {
      const order = ["read-only", "gated", "auto"];
      const next = arg || order[(order.indexOf(state.mode) + 1) % order.length];
      if (!order.includes(next)) { pushLines([` ${color.red(T("msg.modeInvalid"))}`, ""]); return; }
      dispatch({ type: "mode", mode: next });
      pushLines([` ${T("msg.modeSet", { mode: next })}`, ""]);
    },
    clear: async () => { history = []; pushLines([` ${T("msg.cleared")}`, ""]); },
    diff: async () => {
      try {
        const diff = await showDiffImpl(root);
        pushLines(diff ? [...diff.split("\n").map(diffLine), ""] : [` ${color.dim(T("msg.noDiff"))}`, ""]);
      } catch (e) { pushLines([` ${color.red(T("ev.error"))}: ${e?.message || e}`, ""]); }
    },
    changes: async () => {
      try {
        const records = await listChangesImpl(root, 5);
        pushLines(records.length
          ? [...records.map((r) => formatChangeImpl(r)).join("\n\n---\n\n").split("\n").map((l) => ` ${l}`), ""]
          : [` ${color.dim(T("msg.noChanges"))}`, ""]);
      } catch (e) { pushLines([` ${color.red(T("ev.error"))}: ${e?.message || e}`, ""]); }
    },
    recovery: async (arg) => {
      if (!kernel?.recovery) { pushLines([` ${color.yellow(T("banner.offline"))}`, ""]); return; }
      const [action, id] = (arg || "").split(/\s+/).filter(Boolean);
      try {
        if (!action) {
          const report = (await kernel.recovery.report?.()) || { found: [], done: [], blocked: [] };
          const items = (await kernel.recovery.list?.()) || [];
          const lines = [` ${T("ev.recovery")}: found ${report.found.length} done ${report.done.length} blocked ${report.blocked.length}`];
          for (const item of items) lines.push(`   - ${item.id} (${item.type}, ${item.status}) ${color.dim(item.summary || "")}`);
          pushLines([...lines, ""]);
        } else if (action === "resume" && id) {
          const res = await kernel.recovery.resume(id, {});
          pushLines([` ${T("ev.recovery")} resume ${id}: ${res.status}`, ""]);
        } else if (action === "cancel" && id) {
          const res = await kernel.recovery.cancel(id);
          pushLines([` ${T("ev.recovery")} cancel ${id}: ${res?.status || "ok"}`, ""]);
        } else {
          pushLines([` ${color.dim("/recovery [resume|cancel] <id>")}`, ""]);
        }
      } catch (e) { pushLines([` ${color.red(T("ev.error"))}: ${e?.message || e}`, ""]); }
    },
    quit: async () => { dispatch({ type: "exit" }); }
  };

  // T13 会往 SLASH_HANDLERS 加 config;菜单项统一从这里取,保证注册表与处理器一致。
  function activeCommands() {
    return SLASH_COMMANDS.filter((c) => SLASH_HANDLERS[c.name]);
  }

  async function handleSlash(text) {
    dispatch({ type: "submit_local", line: ` ${color.cyan("❯")} ${text}` });
    const parsed = parseSlash(text);
    const handler = parsed && SLASH_HANDLERS[parsed.name];
    if (!handler) {
      pushLines([` ${color.yellow(T("msg.unknownSlash", { name: parsed?.name || "" }))}`, ""]);
      return;
    }
    await handler(parsed.arg);
  }

  function syncSlashMenu() {
    const text = state.input.text;
    if (text.startsWith("/") && !text.includes(" ")) {
      const items = filterCommands(text.slice(1))
        .filter((c) => SLASH_HANDLERS[c.name])
        .map((c) => ({ name: c.name, desc: T(c.descKey) }));
      dispatch({ type: "menu", menu: items.length ? { items, index: 0 } : null });
    } else if (state.menu) {
      dispatch({ type: "menu", menu: null });
    }
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
    if (state.menu) {
      if (ev.type === "up") { dispatch({ type: "menu_move", delta: -1 }); return; }
      if (ev.type === "down") { dispatch({ type: "menu_move", delta: 1 }); return; }
      if (ev.type === "tab") {
        const item = state.menu.items[state.menu.index];
        dispatch({ type: "input_set", text: `/${item.name}` });
        dispatch({ type: "menu", menu: null });
        return;
      }
      if (ev.type === "enter") {
        const item = state.menu.items[state.menu.index];
        dispatch({ type: "input_set", text: `/${item.name}` });
        dispatch({ type: "menu", menu: null });
        submit();
        return;
      }
      if (ev.type === "esc") { dispatch({ type: "menu", menu: null }); return; }
    }
    switch (ev.type) {
      case "char": dispatch({ type: "input_insert", text: ev.text }); syncSlashMenu(); return;
      case "paste": dispatch({ type: "input_insert", text: ev.text }); syncSlashMenu(); return;
      case "enter": submit(); return;
      case "backspace": dispatch({ type: "input_backspace" }); syncSlashMenu(); return;
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
