// gui/main.js — Electron main process
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

let kernel = null;
let projectRoot = null;
let ipcRegistered = false;

const IPC_CHANNELS = [
  "agent:send", "agent:approve", "agent:interrupt",
  "session:timeline", "context:snapshot", "model:usage",
  "config:get", "orchestrator:state"
];

async function initKernel() {
  projectRoot = process.argv.find(a => a.startsWith("--project="))
    ?.split("=")[1] || path.resolve(__dirname, "..");

  const kernelPath = path.join(__dirname, "..", "src", "kernel", "kernel-api.js");
  const { createKernel } = await import(pathToFileURL(kernelPath).href);
  kernel = await createKernel(projectRoot, { config: { allowMissingKey: true } });
  return kernel;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 900, height: 700,
    minWidth: 400, minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    title: "DeepSeek Code"
  });

  try {
    await initKernel();
  } catch (err) {
    console.error("Kernel init failed:", err.message);
  }

  registerIpcHandlers(win);

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

function registerIpcHandlers(win) {
  // Guard against double registration
  if (ipcRegistered) return;
  ipcRegistered = true;

  // agent:send — fire-and-forget. UI gets results via kernel events.
  ipcMain.handle("agent:send", async (_event, message, opts) => {
    if (!kernel) return { error: "Kernel not ready" };
    try {
      // Start the task but DON'T await — the promise may stay pending
      // on AwaitApproval. UI receives status via orchestrator:state events.
      kernel.agent.send(message, opts).then((result) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("kernel:event", {
            type: "agent:result", result: result || { status: "complete" }
          });
        }
      }).catch((err) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("kernel:event", {
            type: "agent:error", error: err.message
          });
        }
      });
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle("agent:approve", (_event, id, decision) => {
    if (!kernel) return { error: "Kernel not ready" };
    kernel.agent.approve(id, decision);
    return { ok: true };
  });

  ipcMain.handle("agent:interrupt", () => {
    if (!kernel) return { error: "Kernel not ready" };
    kernel.agent.interrupt();
    return { ok: true };
  });

  ipcMain.handle("session:timeline", async (_event, count) => {
    if (!kernel) return [];
    return kernel.session.getTimeline(count || 20);
  });

  ipcMain.handle("context:snapshot", async () => {
    if (!kernel) return { units: [] };
    return kernel.context.getSnapshot();
  });

  ipcMain.handle("model:usage", () => {
    if (!kernel?.modelProvider) return {};
    return kernel.modelProvider.getUsageStats();
  });

  ipcMain.handle("config:get", () => {
    if (!kernel) return {};
    const c = kernel.config;
    return { model: c.model, baseUrl: c.baseUrl, thinking: c.thinking?.type || "disabled", reasoningEffort: c.reasoningEffort };
  });

  ipcMain.handle("orchestrator:state", () => {
    if (!kernel?.orchestrator) return { current: "idle", autonomy: "gated", channel: null };
    return kernel.orchestrator.getState();
  });

  // Push kernel events to renderer
  if (kernel) {
    kernel.session.subscribe((event) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("kernel:event", event);
      }
    });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
