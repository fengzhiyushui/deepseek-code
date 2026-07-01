// gui/preload.js — Secure context bridge
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deepseek", {
  send: (message, opts) => ipcRenderer.invoke("agent:send", message, opts),
  approve: (id, decision) => ipcRenderer.invoke("agent:approve", id, decision),
  interrupt: () => ipcRenderer.invoke("agent:interrupt"),
  getTimeline: (count) => ipcRenderer.invoke("session:timeline", count),
  onKernelEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("kernel:event", handler);
    return () => ipcRenderer.removeListener("kernel:event", handler);
  },
  getSnapshot: () => ipcRenderer.invoke("context:snapshot"),
  getUsage: () => ipcRenderer.invoke("model:usage"),
  getPreferences: () => ipcRenderer.invoke("gui:preferences-get"),
  setPreferences: (patch) => ipcRenderer.invoke("gui:preferences-set", patch || {}),
  getConfig: () => ipcRenderer.invoke("config:get"),
  getState: () => ipcRenderer.invoke("orchestrator:state"),
  listBranches: () => ipcRenderer.invoke("session:branches"),
  getActiveBranch: () => ipcRenderer.invoke("session:branch-active"),
  listCheckpoints: (options) => ipcRenderer.invoke("session:checkpoints", options || {}),
  rewindPreview: (options) => ipcRenderer.invoke("session:rewind-preview", options || {}),
  rewindApply: (options) => ipcRenderer.invoke("session:rewind-apply", options || {}),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximizeToggle: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  listTree: () => ipcRenderer.invoke("fs:tree"),
  readFile: (rel) => ipcRenderer.invoke("fs:read", rel),
  ptyStart: (cols, rows) => ipcRenderer.invoke("pty:start", cols, rows),
  ptyInput: (data) => ipcRenderer.invoke("pty:input", data),
  ptyResize: (cols, rows) => ipcRenderer.invoke("pty:resize", cols, rows),
  ptyKill: () => ipcRenderer.invoke("pty:kill"),
  onPtyData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("pty:data", handler);
    return () => ipcRenderer.removeListener("pty:data", handler);
  },
});
