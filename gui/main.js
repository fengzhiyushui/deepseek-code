// gui/main.js - Electron main process
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require("electron");
const path = require("path");
const fs = require("node:fs");
const { createKernelHost, resolveProjectRoot } = require("./kernel-host.js");
const { createPtyHost } = require("./pty-host.js");

// Remove Electron's default native menu bar (File/Edit/View/Window/Help) — the app
// has its own custom title bar; the native one would be a redundant second row.
Menu.setApplicationMenu(null);

let host = null;
let ptyHost = null;
let ipcRegistered = false;

function loadPtySpawn() {
  try { return require("node-pty").spawn; }
  catch { return null; }
}

const IPC_CHANNELS = [
  "agent:send", "agent:approve", "agent:interrupt",
  "session:timeline", "session:branches", "session:branch-active", "session:checkpoints",
  "session:rewind-preview", "session:rewind-apply",
  "context:snapshot", "model:usage",
  "gui:preferences-get", "gui:preferences-set",
  "config:get", "orchestrator:state",
  "window:minimize", "window:maximize", "window:close",
  "fs:tree", "fs:read", "fs:write",
  "pty:start", "pty:input", "pty:resize", "pty:kill",
  "settings:get", "config:set", "api:list", "api:save", "api:delete", "api:activate",
  "models:list", "conn:test", "session:branch-activate", "changes:list", "changes:describe"
];

if (process.env.DEEPSEEK_CODE_GUI_SMOKE === "1") {
  if (process.env.DEEPSEEK_CODE_GUI_USER_DATA) {
    app.setPath("userData", process.env.DEEPSEEK_CODE_GUI_USER_DATA);
  }
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-rasterization");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-features", "UseSkiaRenderer,VizDisplayCompositor");
}

async function createWindow() {
  const smoke = process.env.DEEPSEEK_CODE_GUI_SMOKE === "1";
  const seededChangePath = path.join(
    resolveProjectRoot(process.argv, path.resolve(__dirname, "..")),
    ".deepseek-code", "changes", "20990101000000-smoke0.json"
  );
  if (smoke) {
    // Deterministic first entry for the SCM changes capture (2099 sorts first, removed on quit).
    try {
      fs.mkdirSync(path.dirname(seededChangePath), { recursive: true });
      fs.writeFileSync(seededChangePath, JSON.stringify({
        id: "20990101000000-smoke0",
        time: "2099-01-01T00:00:00.000Z",
        prompt: "smoke: sample agent change",
        diff: "--- a/src/smoke-sample.js\n+++ b/src/smoke-sample.js\n@@ -1,2 +1,3 @@\n line1\n-old\n+new\n+added\n",
        summary: [{ path: "src/smoke-sample.js", status: "modify" }],
        files: [{ path: "src/smoke-sample.js", oldPath: "src/smoke-sample.js", newPath: "src/smoke-sample.js",
          status: "modify", before: "line1\nold\n", after: "line1\nnew\nadded\n" }]
      }, null, 2), "utf8");
    } catch (seedErr) { console.log("SMOKE_SEED_SKIPPED:" + seedErr.message); }
  }
  const win = new BrowserWindow({
    width: smoke ? 1440 : 900,
    height: smoke ? 900 : 700,
    minWidth: 400,
    minHeight: 400,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    title: "Inkstone"
  });

  host = createKernelHost({
    projectRoot: resolveProjectRoot(process.argv, path.resolve(__dirname, "..")),
    pushEvent: (event) => {
      if (win && !win.isDestroyed()) win.webContents.send("kernel:event", event);
    }
  });

  ptyHost = createPtyHost({
    spawn: loadPtySpawn(),
    cwd: resolveProjectRoot(process.argv, path.resolve(__dirname, "..")),
    onData: (d) => { if (win && !win.isDestroyed()) win.webContents.send("pty:data", d); }
  });
  win.on("closed", () => { try { ptyHost?.kill(); } catch { /* ignore */ } });

  try {
    await host.init();
  } catch (error) {
    console.error("Kernel init failed:", error.message);
  }

  registerIpcHandlers();
  // Load order: dev server (DEEPSEEK_CODE_GUI_DEV_URL) → built React renderer (renderer-dist).
  // Neither available → show error dialog and exit (no legacy fallback).
  const devUrl = process.env.DEEPSEEK_CODE_GUI_DEV_URL;
  const builtIndex = path.join(__dirname, "renderer-dist", "index.html");
  if (devUrl) {
    win.loadURL(devUrl);
  } else if (fs.existsSync(builtIndex)) {
    win.loadFile(builtIndex);
  } else {
    const msg = "未找到 renderer-dist 构建产物。请先运行 npm run build:renderer 进行构建。";
    console.error(msg);
    try { dialog.showErrorBox("构建产物缺失", msg); } catch { /* non-interactive ok */ }
    app.quit();
    return;
  }
  if (smoke) {
    win.webContents.once("did-finish-load", async () => {
      try {
        // React mounts asynchronously — poll for the shell + key a11y-labelled nodes.
        const ready = await win.webContents.executeJavaScript(`
          new Promise((resolve) => {
            const ok = () => Boolean(
              document.querySelector(".ide") &&
              document.querySelector('header[role="banner"]') &&
              document.querySelector(".shell") &&
              document.querySelector(".rail") &&
              document.querySelector(".pane") &&
              document.querySelector(".rail-fn") &&
              document.querySelector(".cz-input") &&
              document.querySelector('.titlebar .actions .lang')
            );
            let n = 0;
            const iv = setInterval(() => {
              if (ok() || n++ > 40) { clearInterval(iv); resolve(ok()); }
            }, 100);
          })
        `);
        // Best-effort visual QA (§11):七视图逐个取景。capturePage 在无显示表面的 headless
        // 环境下会间歇失败,故带退避重试;失败只记录,不影响 READY 判定。
        try {
          const dir = path.join(__dirname, "__screenshots__");
          await fs.promises.mkdir(dir, { recursive: true });
          const shoot = async (name) => {
            for (let attempt = 0; attempt < 5; attempt += 1) {
              try {
                const img = await win.webContents.capturePage();
                if (img && img.getSize().width > 0) {
                  await fs.promises.writeFile(path.join(dir, `${name}.png`), img.toPNG());
                  return true;
                }
              } catch { /* 下一轮重试 */ }
              await new Promise((r) => setTimeout(r, 500));
            }
            console.log("SMOKE_SCREENSHOT_SKIPPED:" + name);
            return false;
          };
          const click = async (selector) => {
            await win.webContents.executeJavaScript(
              `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return Boolean(el); })()`
            );
            await new Promise((r) => setTimeout(r, 350));
          };

          await shoot("shell-desktop");                                   // 首页
          await click(".rail-new"); await shoot("shell-chat");            // 会话
          await click(".rail-fn .fn-item:nth-child(3)"); await shoot("shell-changes");
          await click(".rail-fn .fn-item:nth-child(2)"); await shoot("shell-projects");
          await click(".rail-foot .iconbtn"); await shoot("shell-settings");
          await click(".s-nav .sn-item:nth-child(3)"); await shoot("shell-appearance");
          await click(".s-nav .sn-item:nth-child(4)"); await shoot("shell-status-display");
          await click(".rail-fn .fn-item:nth-child(1)");                  // 回首页再截窄屏
          win.setSize(800, 720);
          await new Promise((r) => setTimeout(r, 500));
          await shoot("shell-narrow");
        } catch (shotErr) {
          console.log("SMOKE_SCREENSHOT_SKIPPED:" + shotErr.message);
        }
        console.log(ready ? "GUI_SMOKE_READY" : "GUI_SMOKE_FAILED");
      } catch (err) {
        console.log("GUI_SMOKE_FAILED:" + err.message);
      }
      try { fs.rmSync(seededChangePath, { force: true }); } catch { /* best-effort */ }
      app.quit();
    });
  }
  return win;
}

function registerIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  // Custom title-bar window controls (native frame is hidden via titleBarStyle).
  ipcMain.handle("window:minimize", (e) => { BrowserWindow.fromWebContents(e.sender)?.minimize(); });
  ipcMain.handle("window:maximize", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) { w.isMaximized() ? w.unmaximize() : w.maximize(); }
  });
  ipcMain.handle("window:close", (e) => { BrowserWindow.fromWebContents(e.sender)?.close(); });

  // File bridge (read-only project files for the tree + editor).
  ipcMain.handle("fs:tree", async () => {
    try { return await host.listTree(); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("fs:read", async (_event, rel) => {
    try { return await host.readFile(rel); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("fs:write", async (_event, rel, content) => {
    try { return await host.writeFile(rel, content); }
    catch (error) { return { error: error.message }; }
  });

  // Interactive terminal (node-pty) bridge.
  ipcMain.handle("pty:start", (_e, cols, rows) => { ptyHost?.start(cols, rows); return { available: Boolean(ptyHost?.available) }; });
  ipcMain.handle("pty:input", (_e, data) => { ptyHost?.write(data); });
  ipcMain.handle("pty:resize", (_e, cols, rows) => { ptyHost?.resize(cols, rows); });
  ipcMain.handle("pty:kill", () => { ptyHost?.kill(); });

  // Settings / config / API profiles / models.
  const wrap = (fn) => async (...args) => { try { return await fn(...args); } catch (error) { return { error: error.message }; } };
  ipcMain.handle("settings:get", wrap(() => host.getSettings()));
  ipcMain.handle("config:set", wrap((_e, patch) => host.setConfig(patch)));
  ipcMain.handle("api:list", wrap(() => host.listApiProfiles()));
  ipcMain.handle("api:save", wrap((_e, p) => host.saveApiProfile(p)));
  ipcMain.handle("api:delete", wrap((_e, id) => host.deleteApiProfile(id)));
  ipcMain.handle("api:activate", wrap((_e, id) => host.activateApiProfile(id)));
  ipcMain.handle("models:list", wrap((_e, profileId) => host.listModels(profileId)));
  ipcMain.handle("conn:test", wrap((_e, profileId) => host.testConnection(profileId)));
  ipcMain.handle("session:branch-activate", wrap((_e, id) => host.activateBranch(id)));
  ipcMain.handle("changes:list", wrap((_e, limit) => host.listChanges({ limit })));
  ipcMain.handle("changes:describe", wrap((_e, id, relPath) => host.describeChange(id, relPath)));

  ipcMain.handle("agent:send", async (_event, message, opts) => {
    try { return await host.send(message, opts || {}); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("agent:approve", async (_event, id, decision) => {
    try { return await host.approve(id, decision); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("agent:interrupt", () => {
    try { return host.interrupt(); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("session:timeline", async (_event, count) => host?.getTimeline(count || 20) || []);
  ipcMain.handle("session:branches", async () => {
    try { return await host.listBranches(); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("session:branch-active", async () => {
    try { return await host.getActiveBranch(); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("session:checkpoints", async (_event, options) => {
    try { return await host.listCheckpoints(options || {}); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("session:rewind-preview", async (_event, options) => {
    try { return await host.rewindPreview(options || {}); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("session:rewind-apply", async (_event, options) => {
    try { return await host.rewindApply(options || {}); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("context:snapshot", async () => host?.getSnapshot() || { units: [] });
  ipcMain.handle("model:usage", () => host?.getUsage() || {});
  ipcMain.handle("gui:preferences-get", async () => {
    try { return await host.getPreferences(); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("gui:preferences-set", async (_event, patch) => {
    try { return await host.setPreferences(patch || {}); }
    catch (error) { return { error: error.message }; }
  });
  ipcMain.handle("config:get", () => host?.getConfig() || {});
  ipcMain.handle("orchestrator:state", () => host?.getState() || { current: "idle", channel: null });
  ipcMain.handle("projects:list", async () => { try { return await host.listProjects(); } catch (error) { return { error: error.message }; } });
  ipcMain.handle("projects:add", async (_event, root) => { try { return await host.addProject(root); } catch (error) { return { error: error.message }; } });
  ipcMain.handle("projects:remove", async (_event, root) => { try { return await host.removeProject(root); } catch (error) { return { error: error.message }; } });
  ipcMain.handle("projects:switch", async (_event, root) => { try { return await host.switchProject(root); } catch (error) { return { error: error.message }; } });
  ipcMain.handle("sessions:list", async () => { try { return await host.listSessions(); } catch (error) { return { error: error.message }; } });
  // 在系统文件管理器中显示项目目录(设计稿的「在终端打开」在无终端面板时降级为此)。
  ipcMain.handle("projects:reveal", async (_event, root) => {
    try { const err = await shell.openPath(String(root || "")); return err ? { error: err } : { ok: true }; }
    catch (error) { return { error: error.message }; }
  });
  // 「打开文件夹…」:唯一需要选目录的入口(新增项目)。取消时返回 { canceled: true },不改注册表。
  ipcMain.handle("projects:pick", async () => {
    try {
      const win = BrowserWindow.getAllWindows()[0];
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled || !result.filePaths || !result.filePaths.length) return { canceled: true };
      return { root: result.filePaths[0] };
    } catch (error) { return { error: error.message }; }
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  host?.dispose?.();
  app.quit();
});
