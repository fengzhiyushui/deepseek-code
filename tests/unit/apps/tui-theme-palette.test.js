import test from "node:test";
import assert from "node:assert/strict";
import { hexToXterm } from "../../../scripts/gen-tui-theme.js";
import { TUI_THEMES, DEFAULT_TUI_THEME } from "../../../src/apps/tui/theme-palette.js";

const SLOTS = ["bg", "panel", "fg", "mut", "faint", "border", "accent", "accentHover", "ok", "warn", "err", "info"];

test("TUI 调色板:10 主题 × 全部槽位非空且色号在 16–255", () => {
  const ids = Object.keys(TUI_THEMES);
  assert.equal(ids.length, 10, `期望 10 主题,实得 ${ids.length}`);
  for (const id of ids) {
    const theme = TUI_THEMES[id];
    assert.ok(theme.id === id && typeof theme.name === "string" && theme.name.length > 0);
    for (const slot of SLOTS) {
      assert.ok(slot in theme, `主题 ${id} 缺槽位 ${slot}`);
      const idx = theme[slot];
      assert.ok(Number.isInteger(idx), `主题 ${id} ${slot} 非整数:${idx}`);
      assert.ok(idx >= 16 && idx <= 255, `主题 ${id} ${slot} 色号越界:${idx}`);
    }
  }
});

test("默认主题为 sumi(墨)", () => {
  assert.equal(DEFAULT_TUI_THEME, "sumi");
  assert.ok(DEFAULT_TUI_THEME in TUI_THEMES);
});

test("hexToXterm:灰阶与色立方映射边界", () => {
  assert.equal(hexToXterm("#000000"), 16);   // 纯黑 → 16
  assert.equal(hexToXterm("#ffffff"), 231);  // 纯白 → 231(灰阶带末端)
  assert.equal(hexToXterm("#808080"), 244);  // 中灰 → 244(128→(128-8)/10=12→232+12=244)
  // 色立方:纯红 #ff0000 → R=255,G=0,B=0 → 16 + 36*5 + 6*0 + 0 = 196
  assert.equal(hexToXterm("#ff0000"), 196);
  assert.equal(hexToXterm("#00ff00"), 46);   // 纯绿 → 16 + 36*0 + 6*5 + 0 = 46
  assert.equal(hexToXterm("#0000ff"), 21);   // 纯蓝 → 16 + 36*0 + 6*0 + 5 = 21
});
