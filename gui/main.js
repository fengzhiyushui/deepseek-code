// gui/main.js - Electron main process
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
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
  "fs:tree", "fs:read",
  "pty:start", "pty:input", "pty:resize", "pty:kill",
  "settings:get", "config:set", "api:list", "api:save", "api:delete", "api:activate",
  "models:list", "conn:test", "session:branch-activate"
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
    title: "DeepSeek Code"
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
  // Load order: dev server (DEEPSEEK_CODE_GUI_DEV_URL) → built React renderer
  // (renderer-dist) → legacy vanilla renderer (dormant fallback until the React build exists).
  const devUrl = process.env.DEEPSEEK_CODE_GUI_DEV_URL;
  const builtIndex = path.join(__dirname, "renderer-dist", "index.html");
  if (devUrl) {
    win.loadURL(devUrl);
  } else if (fs.existsSync(builtIndex)) {
    win.loadFile(builtIndex);
  } else {
    win.loadFile(path.join(__dirname, "renderer", "index.html"));
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
              document.querySelector(".editor") &&
              document.querySelector('footer[role="contentinfo"]') &&
              document.querySelector('.activity[role="tablist"] button[role="tab"][aria-label]') &&
              document.querySelector('.agent [role="log"]') &&
              document.querySelector('.acomposer textarea[aria-label]') &&
              document.querySelector('.titlebar .actions .lang')
            );
            let n = 0;
            const iv = setInterval(() => {
              if (ok() || n++ > 40) { clearInterval(iv); resolve(ok()); }
            }, 100);
          })
        `);
        // Best-effort visual QA: desktop (1440) + narrow (800) screenshots (§11).
        try {
          const dir = path.join(__dirname, "__screenshots__");
          await fs.promises.mkdir(dir, { recursive: true });
          const desktop = await win.webContents.capturePage();
          await fs.promises.writeFile(path.join(dir, "shell-desktop.png"), desktop.toPNG());
          win.setSize(800, 720);
          await new Promise((r) => setTimeout(r, 400));
          const narrow = await win.webContents.capturePage();
          await fs.promises.writeFile(path.join(dir, "shell-narrow.png"), narrow.toPNG());
        } catch (shotErr) {
          console.log("SMOKE_SCREENSHOT_SKIPPED:" + shotErr.message);
        }
        console.log(ready ? "GUI_SMOKE_READY" : "GUI_SMOKE_FAILED");
      } catch (err) {
        console.log("GUI_SMOKE_FAILED:" + err.message);
      }
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
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  host?.dispose?.();
  app.quit();
});
