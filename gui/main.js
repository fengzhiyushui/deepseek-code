// gui/main.js - Electron main process
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { createKernelHost, resolveProjectRoot } = require("./kernel-host.js");

let host = null;
let ipcRegistered = false;

const IPC_CHANNELS = [
  "agent:send", "agent:approve", "agent:interrupt",
  "session:timeline", "session:branches", "session:branch-active", "session:checkpoints",
  "session:rewind-preview", "session:rewind-apply",
  "context:snapshot", "model:usage",
  "config:get", "orchestrator:state"
];

async function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 400,
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

  try {
    await host.init();
  } catch (error) {
    console.error("Kernel init failed:", error.message);
  }

  registerIpcHandlers();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

function registerIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;

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
  ipcMain.handle("config:get", () => host?.getConfig() || {});
  ipcMain.handle("orchestrator:state", () => host?.getState() || { current: "idle", channel: null });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  host?.dispose?.();
  app.quit();
});
