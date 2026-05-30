import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(file) {
  return readFile(file, "utf8");
}

test("migrated CLI ask edit test entrypoints use V2 kernel runner", async () => {
  const cli = await source("src/cli.js");

  assert.match(cli, /runKernelAgentCommand/);
  assert.match(cli, /runKernelTestCommand/);
  assert.doesNotMatch(cli, /askCommand/);
  assert.doesNotMatch(cli, /editCommand/);
  assert.doesNotMatch(cli, /from "\.\/agent\.js"/);
});

test("TUI and GUI host do not import the old V1 kernel api", async () => {
  const tui = await source("src/tui.js");
  const guiMain = await source("gui/main.js");
  const guiHost = await source("gui/kernel-host.js");

  assert.match(tui, /from "\.\/index\.js"/);
  assert.doesNotMatch(tui, /kernel-api/);
  assert.doesNotMatch(guiMain, /src[\\/]+kernel[\\/]+kernel-api|kernel-api/);
  assert.doesNotMatch(guiHost, /src[\\/]+kernel[\\/]+kernel-api|kernel-api/);
});
