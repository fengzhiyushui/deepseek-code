import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_ACTIONS, CONFIG_FIELDS, initialConfigState, reduceConfig, renderConfigLines } from "../../../src/apps/tui/config-flow.js";
import { maskKey } from "../../../src/apps/api-profiles.js";
import { makeT } from "../../../src/apps/tui/tui-i18n.js";

const t = makeT("zh");
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
const P = [{ id: "p_1", name: "main", baseUrl: "https://api.deepseek.com", apiKey: "sk-1234567890abcd", model: "deepseek-chat" }];

test("list view: rows + add-new entry, wrap navigation over profiles+1", () => {
  let cfg = initialConfigState({ profiles: P, activeId: "p_1" });
  assert.equal(cfg.view, "list");
  cfg = reduceConfig(cfg, { type: "cfg_move", delta: 1 }); // → 新增项
  assert.equal(cfg.index, 1);
  cfg = reduceConfig(cfg, { type: "cfg_move", delta: 1 }); // 回绕
  assert.equal(cfg.index, 0);
  const out = renderConfigLines(cfg, t, maskKey, 100);
  const text = out.lines.map(strip).join("\n");
  assert.match(text, /main/);
  assert.match(text, /●已激活/);
  assert.match(text, /sk-…abcd/);
  assert.match(text, /\+ 新增配置/);
  assert.doesNotMatch(text, /sk-1234567890abcd/);
  assert.equal(out.cursorRow, null);
});

test("draft edit: field input masked in render, field_next walks fields", () => {
  let cfg = initialConfigState({ profiles: [], activeId: null });
  cfg = reduceConfig(cfg, { type: "cfg_draft_new" });
  assert.equal(cfg.view, "edit");
  assert.deepEqual(CONFIG_FIELDS, ["name", "baseUrl", "apiKey", "model"]);
  cfg = reduceConfig(cfg, { type: "cfg_field_input", text: "p1" });
  cfg = reduceConfig(cfg, { type: "cfg_field_next" });
  cfg = reduceConfig(cfg, { type: "cfg_field_next" }); // 到 apiKey
  cfg = reduceConfig(cfg, { type: "cfg_field_input", text: "sk-secret" });
  cfg = reduceConfig(cfg, { type: "cfg_field_backspace" });
  assert.equal(cfg.draft.apiKey, "sk-secre");
  const out = renderConfigLines(cfg, t, maskKey, 100);
  const text = out.lines.map(strip).join("\n");
  assert.doesNotMatch(text, /sk-secre/);
  assert.match(text, /••••••••/); // 8 个掩码点
  assert.equal(typeof out.cursorRow, "number");
});

test("models view: pick writes draft.model and returns to edit", () => {
  let cfg = initialConfigState({ profiles: P, activeId: null });
  cfg = reduceConfig(cfg, { type: "cfg_draft_edit", profile: P[0] });
  cfg = reduceConfig(cfg, { type: "cfg_models", models: ["m1", "m2"] });
  assert.equal(cfg.view, "models");
  cfg = reduceConfig(cfg, { type: "cfg_move", delta: 1 });
  cfg = reduceConfig(cfg, { type: "cfg_model_pick" });
  assert.equal(cfg.view, "edit");
  assert.equal(cfg.draft.model, "m2");
});

test("actions view renders CONFIG_ACTIONS; error renders red line", () => {
  let cfg = initialConfigState({ profiles: P, activeId: null });
  cfg = reduceConfig(cfg, { type: "cfg_view", view: "actions" });
  let out = renderConfigLines(cfg, t, maskKey, 100).lines.map(strip).join("\n");
  for (const key of ["激活", "编辑", "拉取模型列表", "连接测试", "删除"]) assert.match(out, new RegExp(key));
  cfg = reduceConfig(cfg, { type: "cfg_error", error: "boom" });
  out = renderConfigLines(cfg, t, maskKey, 100).lines.map(strip).join("\n");
  assert.match(out, /boom/);
  assert.equal(CONFIG_ACTIONS.length, 5);
});
