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
  getConfig: () => ipcRenderer.invoke("config:get"),
  getState: () => ipcRenderer.invoke("orchestrator:state"),
});
