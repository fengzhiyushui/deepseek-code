// src/apps/tui/config-flow.js — /config 交互状态机(纯)。IO(读写存储/拉模型/测试/激活)全在 tui-app。
import { truncateToWidth, displayWidth } from "./ansi.js";
import { tc as color } from "./theme.js";

export const CONFIG_ACTIONS = ["activate", "edit", "models", "test", "delete"];
export const CONFIG_FIELDS = ["name", "baseUrl", "apiKey", "model"];

export function initialConfigState({ profiles = [], activeId = null } = {}) {
  return {
    view: "list", profiles, activeId,
    index: 0, actionIndex: 0,
    draft: null, field: 0,
    models: [], modelIndex: 0,
    notice: "", error: ""
  };
}

function wrap(index, delta, length) {
  if (!length) return 0;
  return ((index + delta) % length + length) % length;
}

export function reduceConfig(cfg, action = {}) {
  switch (action.type) {
    case "cfg_profiles": {
      const profiles = action.profiles || [];
      return { ...cfg, profiles, activeId: action.activeId ?? null, index: Math.min(cfg.index, profiles.length), view: "list", notice: cfg.notice, error: "" };
    }
    case "cfg_move": {
      if (cfg.view === "list") return { ...cfg, index: wrap(cfg.index, action.delta, cfg.profiles.length + 1) };
      if (cfg.view === "actions") return { ...cfg, actionIndex: wrap(cfg.actionIndex, action.delta, CONFIG_ACTIONS.length) };
      if (cfg.view === "models") return { ...cfg, modelIndex: wrap(cfg.modelIndex, action.delta, cfg.models.length) };
      return cfg;
    }
    case "cfg_view": return { ...cfg, view: action.view, actionIndex: 0, notice: "", error: "" };
    case "cfg_draft_new":
      return { ...cfg, view: "edit", field: 0, error: "", draft: { id: null, name: "", baseUrl: "https://api.deepseek.com", apiKey: "", model: "" } };
    case "cfg_draft_edit":
      return { ...cfg, view: "edit", field: 0, error: "", draft: { ...action.profile } };
    case "cfg_field_input": {
      const key = CONFIG_FIELDS[cfg.field];
      return { ...cfg, draft: { ...cfg.draft, [key]: String(cfg.draft[key] || "") + String(action.text || "").replace(/[\r\n]/g, "") } };
    }
    case "cfg_field_backspace": {
      const key = CONFIG_FIELDS[cfg.field];
      const value = Array.from(String(cfg.draft[key] || ""));
      value.pop();
      return { ...cfg, draft: { ...cfg.draft, [key]: value.join("") } };
    }
    case "cfg_field_next": return { ...cfg, field: Math.min(cfg.field + 1, CONFIG_FIELDS.length - 1) };
    case "cfg_models": return { ...cfg, view: "models", models: action.models || [], modelIndex: 0, error: "" };
    case "cfg_model_pick":
      return { ...cfg, view: "edit", draft: { ...cfg.draft, model: cfg.models[cfg.modelIndex] || cfg.draft.model } };
    case "cfg_notice": return { ...cfg, notice: String(action.notice || ""), error: "" };
    case "cfg_error": return { ...cfg, error: String(action.error || ""), notice: "" };
    default: return cfg;
  }
}

function row(selected, text, width) {
  const line = ` ${truncateToWidth(text, width - 2)}`;
  return selected ? color.inverse(line) : line;
}

// 渲染行含 ANSI 包装;光标列按去码后的显示宽度算
function stripWidth(line) {
  return displayWidth(line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ""));
}

export function renderConfigLines(cfg, t, maskKeyFn, columns) {
  const width = Math.max(30, Number(columns) || 80);
  const lines = [];
  let cursorRow = null;
  let cursorCol = null;

  if (cfg.view === "list") {
    lines.push(` ${color.bold(t("cfg.title"))}`);
    if (!cfg.profiles.length) lines.push(` ${color.dim(t("cfg.empty"))}`);
    cfg.profiles.forEach((p, i) => {
      const active = p.id === cfg.activeId ? ` ${color.green(t("cfg.active"))}` : "";
      lines.push(row(i === cfg.index, `${p.name || p.id} · ${p.baseUrl || "-"} · ${p.model || "-"} · ${maskKeyFn(p.apiKey)}${active}`, width));
    });
    lines.push(row(cfg.index === cfg.profiles.length, t("cfg.new"), width));
  } else if (cfg.view === "actions") {
    const profile = cfg.profiles[cfg.index] || {};
    lines.push(` ${color.bold(profile.name || profile.id || "?")}`);
    CONFIG_ACTIONS.forEach((name, i) => lines.push(row(i === cfg.actionIndex, t(`cfg.act.${name}`), width)));
  } else if (cfg.view === "edit") {
    lines.push(` ${color.dim(t("cfg.editHint"))}`);
    CONFIG_FIELDS.forEach((key, i) => {
      const raw = String(cfg.draft?.[key] || "");
      const shown = key === "apiKey" ? "•".repeat(Array.from(raw).length) : raw;
      const line = ` ${t(`cfg.field.${key}`)}: ${shown}`;
      lines.push(i === cfg.field ? color.bold(line) : line);
      if (i === cfg.field) {
        cursorRow = lines.length - 1;
        cursorCol = stripWidth(line) + 1;
      }
    });
  } else if (cfg.view === "models") {
    lines.push(` ${color.bold(t("cfg.modelsTitle"))}`);
    cfg.models.forEach((m, i) => lines.push(row(i === cfg.modelIndex, m, width)));
  }

  if (cfg.notice) lines.push(` ${color.green(truncateToWidth(cfg.notice, width - 2))}`);
  if (cfg.error) lines.push(` ${color.red(truncateToWidth(cfg.error, width - 2))}`);
  return { lines, cursorRow, cursorCol };
}
