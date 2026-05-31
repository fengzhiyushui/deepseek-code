import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("renderer workbench html exposes natural agent workbench regions and controls", async () => {
  const html = await readFile("gui/renderer/index.html", "utf8");

  for (const id of [
    "command-bar",
    "activity-rail",
    "context-panel",
    "agent-session",
    "contextual-inspector",
    "statusline",
    "traffic-light",
    "traffic-light-label",
    "theme-toggle",
    "context-collapse",
    "rail-chat",
    "rail-context",
    "rail-branches",
    "rail-timeline",
    "rail-settings",
    "context-panel-title",
    "empty-state",
    "branch-list",
    "checkpoint-list",
    "rewind-preview",
    "rewind-apply",
    "rewind-force",
    "activity-log",
    "messages",
    "msg-input",
    "command-task",
    "command-branch",
    "statusline-branch",
    "metric-tokens",
    "metric-cache",
    "metric-latency",
    "metric-requests",
    "error-strip"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} missing`);
  }

  assert.ok(html.includes('data-theme="night"'), "default night theme missing");
  assert.ok(html.includes('aria-label="Activity navigation"'), "rail a11y label missing");
  assert.ok(html.includes('aria-label="Toggle color theme"'), "theme toggle label missing");
});

test("renderer css defines two-theme natural workbench tokens without decorative gradients", async () => {
  const css = await readFile("gui/renderer/style.css", "utf8");

  assert.ok(css.includes(".workbench-shell"));
  assert.ok(css.includes('[data-theme="night"]'));
  assert.ok(css.includes('[data-theme="day"]'));
  assert.ok(css.includes("#command-bar"));
  assert.ok(css.includes("#activity-rail"));
  assert.ok(css.includes("#context-panel"));
  assert.ok(css.includes("#agent-session"));
  assert.ok(css.includes("#contextual-inspector"));
  assert.ok(css.includes("#statusline"));
  assert.ok(css.includes("grid-template-columns"));
  assert.ok(css.includes(":root"));
  for (const token of [
    "--color-bg",
    "--color-bg-panel",
    "--color-bg-main",
    "--color-bg-elevated",
    "--color-text",
    "--color-text-muted",
    "--color-border",
    "--color-border-strong",
    "--color-accent",
    "--color-success",
    "--color-warning",
    "--color-danger",
    "--color-offline",
    "--color-focus",
    "--color-diff-add",
    "--color-diff-remove"
  ]) {
    assert.ok(css.includes(token), `${token} missing`);
  }
  assert.ok(css.includes(".traffic-light"));
  assert.ok(css.includes('.traffic-light[data-tone="ready"]'));
  assert.ok(css.includes('.traffic-light[data-tone="working"]'));
  assert.ok(css.includes('.traffic-light[data-tone="error"]'));
  assert.ok(css.includes('.traffic-light[data-tone="offline"]'));
  assert.ok(css.includes(".error-strip"));
  assert.ok(css.includes(".branch-item.selected"));
  assert.ok(css.includes(".checkpoint-item.selected"));
  assert.ok(css.includes(".is-loading"));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("@media (max-width: 1200px)"));
  assert.ok(css.includes("@media (max-width: 900px)"));
  assert.ok(css.includes("@media (max-width: 760px)"));
  assert.ok(css.includes(".drawer-open"));
  assert.ok(css.includes(".branch-item"));
  assert.ok(css.includes(".checkpoint-item"));
  assert.ok(css.includes(".rewind-preview"));
  assert.equal(css.includes("radial-gradient"), false);
  assert.equal(css.includes("linear-gradient"), false);
});

test("renderer app wires branch checkpoint and rewind api methods", async () => {
  const app = await readFile("gui/renderer/app.js", "utf8");

  for (const token of [
    "renderCommandBar",
    "renderContextPanel",
    "renderStatusline",
    "renderTheme",
    "rail_mode_changed",
    "context_collapsed_changed",
    "theme_changed",
    "inspector_mode_changed",
    "listBranches",
    "getActiveBranch",
    "listCheckpoints",
    "rewindPreview",
    "rewindApply",
    "renderBranches",
    "renderCheckpoints",
    "renderRewindPreview",
    "renderEmptyState",
    "statusSummary",
    "trafficTone",
    "trafficLabel",
    "createFallbackApi",
    "reportError",
    "renderErrors",
    "loading_changed"
  ]) {
    assert.ok(app.includes(token), `${token} missing`);
  }
});

test("gui preload and main expose preference ipc bridge", async () => {
  const main = await readFile("gui/main.js", "utf8");
  const preload = await readFile("gui/preload.js", "utf8");

  assert.ok(main.includes("gui:preferences-get"));
  assert.ok(main.includes("gui:preferences-set"));
  assert.ok(preload.includes("getPreferences"));
  assert.ok(preload.includes("setPreferences"));
  assert.ok(preload.includes("gui:preferences-get"));
  assert.ok(preload.includes("gui:preferences-set"));
});

test("renderer app loads persists preferences and binds keyboard shortcuts", async () => {
  const app = await readFile("gui/renderer/app.js", "utf8");

  for (const token of [
    "loadPreferences",
    "persistPreferences",
    "bindKeyboardShortcuts",
    "preferences_loaded",
    "inspector_closed",
    "Ctrl+K",
    "event.ctrlKey",
    "focusComposer",
    "getPreferences",
    "setPreferences"
  ]) {
    assert.ok(app.includes(token), `${token} missing`);
  }
});

test("renderer exposes explicit inspector close control", async () => {
  const html = await readFile("gui/renderer/index.html", "utf8");
  const css = await readFile("gui/renderer/style.css", "utf8");
  const app = await readFile("gui/renderer/app.js", "utf8");

  assert.ok(html.includes('id="inspector-close"'));
  assert.ok(html.includes('aria-label="Close inspector"'));
  assert.ok(css.includes(".inspector-close"));
  assert.ok(app.includes("inspector-close"));
  assert.ok(app.includes("focusInspector"));
});

test("renderer compact layout prevents overlapping drawers", async () => {
  const css = await readFile("gui/renderer/style.css", "utf8");
  const app = await readFile("gui/renderer/app.js", "utf8");

  assert.ok(css.includes(".workbench-shell.inspector-open #context-panel"));
  assert.ok(css.includes("right: var(--space-3)"));
  assert.ok(css.includes("left: var(--space-3)"));
  assert.ok(css.includes("body { overflow: hidden; }"));
  assert.ok(app.includes("isCompactViewport"));
  assert.ok(app.includes("inspector-open"));
});

test("renderer files avoid unsafe html injection and garbled legacy labels", async () => {
  const html = await readFile("gui/renderer/index.html", "utf8");
  const app = await readFile("gui/renderer/app.js", "utf8");

  assert.equal(/\.[\s\n]*innerHTML\s*=/.test(app), false, "no innerHTML assignment");
  assert.equal(html.includes("馃"), false);
  assert.equal(html.includes("鉁"), false);
  assert.equal(html.includes("杈"), false);
  assert.equal(html.includes("鍙"), false);
});
