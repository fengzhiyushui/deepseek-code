// gui/kernel-host.js
const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");

let apiProfilesModPromise = null;
function loadApiProfilesMod() {
  if (!apiProfilesModPromise) apiProfilesModPromise = import(pathToFileURL(path.join(__dirname, "..", "src", "apps", "api-profiles.js")).href);
  return apiProfilesModPromise;
}

let configModPromise = null;
function loadConfigMod() {
  if (!configModPromise) configModPromise = import(pathToFileURL(path.join(__dirname, "..", "src", "config.js")).href);
  return configModPromise;
}
let providerModPromise = null;
function loadProviderMod() {
  if (!providerModPromise) providerModPromise = import(pathToFileURL(path.join(__dirname, "..", "src", "provider.js")).href);
  return providerModPromise;
}

let editServiceModPromise = null;
function loadEditServiceMod() {
  if (!editServiceModPromise) editServiceModPromise = import(pathToFileURL(path.join(__dirname, "..", "src", "edits", "edit-service.js")).href);
  return editServiceModPromise;
}

let saveDiffModPromise = null;
function loadSaveDiffMod() {
  if (!saveDiffModPromise) saveDiffModPromise = import(pathToFileURL(path.join(__dirname, "src", "state", "save-diff.js")).href);
  return saveDiffModPromise;
}

let changeStoreModPromise = null;
function loadChangeStoreMod() {
  if (!changeStoreModPromise) changeStoreModPromise = import(pathToFileURL(path.join(__dirname, "..", "src", "edits", "change-store.js")).href);
  return changeStoreModPromise;
}
let patchModPromise = null;
function loadPatchMod() {
  if (!patchModPromise) patchModPromise = import(pathToFileURL(path.join(__dirname, "..", "src", "patch.js")).href);
  return patchModPromise;
}

function maskKeyStr(k) {
  if (!k) return "";
  const s = String(k);
  return s.length <= 8 ? "…" : `${s.slice(0, 3)}…${s.slice(-4)}`;
}
function maskProfile(p) {
  return { id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model || null, hasKey: Boolean(p.apiKey), keyMask: maskKeyStr(p.apiKey) };
}
function maskConfig(cfg) {
  const c = { ...(cfg || {}) };
  const hasApiKey = Boolean(c.apiKey);
  delete c.apiKey;
  return { ...c, hasApiKey };
}

const GUI_PREFERENCE_DEFAULTS = Object.freeze({
  schema: 1,
  theme: "night",
  language: "zh",
  railMode: "chat",
  contextCollapsed: false
});

const GUI_RAIL_MODES = new Set(["chat", "context", "branches", "timeline", "settings"]);

const EXT_LANGUAGE = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", py: "python", json: "json", md: "markdown",
  css: "css", scss: "scss", html: "html", htm: "html", yml: "yaml", yaml: "yaml",
  sh: "shell", bash: "shell", txt: "plaintext"
};

function languageForExt(relPath) {
  const ext = String(relPath || "").split(".").pop().toLowerCase();
  return EXT_LANGUAGE[ext] || "plaintext";
}

// Lazily load the ESM workspace path-safety util (kernel-host is CommonJS).
let pathSafetyPromise = null;
function loadPathSafety() {
  if (!pathSafetyPromise) {
    const p = path.join(__dirname, "..", "src", "workspace", "path-safety.js");
    pathSafetyPromise = import(pathToFileURL(p).href);
  }
  return pathSafetyPromise;
}

function resolveProjectRoot(argv = process.argv, fallback = path.resolve(__dirname, "..")) {
  const projectArg = argv.find((arg) => arg.startsWith("--project="));
  return projectArg ? projectArg.slice("--project=".length) : fallback;
}

function zeroUsage() {
  return {
    requests: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_reasoning_tokens: 0,
    total_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    cache_hit_rate: 0,
    avg_latency_ms: 0,
    by_channel: {},
    by_model: {}
  };
}

function guiPreferencePath(projectRoot) {
  return path.join(projectRoot, ".deepseek-code", "gui-preferences.json");
}

function normalizeGuiPreferences(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    schema: 1,
    theme: input.theme === "day" ? "day" : "night",
    language: input.language === "en" ? "en" : "zh",
    railMode: GUI_RAIL_MODES.has(input.railMode) ? input.railMode : "chat",
    contextCollapsed: typeof input.contextCollapsed === "boolean" ? input.contextCollapsed : false
  };
}

async function loadGuiPreferences(projectRoot) {
  try {
    const raw = await fs.readFile(guiPreferencePath(projectRoot), "utf8");
    return normalizeGuiPreferences(JSON.parse(raw));
  } catch {
    return { ...GUI_PREFERENCE_DEFAULTS };
  }
}

async function saveGuiPreferences(projectRoot, patch = {}) {
  const current = await loadGuiPreferences(projectRoot);
  const next = normalizeGuiPreferences({ ...current, ...patch });
  const target = guiPreferencePath(projectRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function loadLegacyConfig(projectRoot) {
  const configPath = path.join(__dirname, "..", "src", "config.js");
  const mod = await import(pathToFileURL(configPath).href);
  return mod.loadConfig(projectRoot, { allowMissingKey: true });
}

async function buildKernelOptions(projectRoot, overrides = {}, configLoader = loadLegacyConfig) {
  if (overrides.modelGateway || overrides.deepseek) return overrides;
  let config = {};
  try {
    config = await configLoader(projectRoot);
  } catch {
    config = {};
  }
  if (!config.apiKey) return overrides;
  const result = {
    ...overrides,
    deepseek: {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    }
  };
  if (config.limits) result.limits = config.limits;
  return result;
}

function createKernelHost({
  projectRoot = resolveProjectRoot(),
  kernelFactory = null,
  kernelOptions = {},
  configLoader = loadLegacyConfig,
  editService = null,
  pushEvent = () => {}
} = {}) {
  let kernel = null;
  let subscription = null;
  let guiEditService = editService;

  async function init() {
    if (!kernelFactory) {
      const kernelPath = path.join(__dirname, "..", "src", "index.js");
      const mod = await import(pathToFileURL(kernelPath).href);
      kernelFactory = mod.createKernel;
    }
    const options = await buildKernelOptions(projectRoot, kernelOptions, configLoader);
    kernel = await kernelFactory(projectRoot, options);
    subscription = kernel.session.subscribe((event) => pushEvent(event));
    return kernel;
  }

  function ready() {
    return Boolean(kernel);
  }

  function requireKernel() {
    if (!kernel) throw new Error("Kernel not ready");
    return kernel;
  }

  async function send(message, opts = {}) {
    const k = requireKernel();
    // V2 runtime publishes agent:final natively; host only catches errors.
    k.agent.send(message, opts).catch((error) => {
      pushEvent({ type: "agent:error", error: error.message });
    });
    return { ok: true };
  }

  async function approve(id, decision) {
    const result = await requireKernel().agent.approve(id, decision);
    return { ok: true, result };
  }

  function interrupt() {
    requireKernel().agent.interrupt();
    return { ok: true };
  }

  async function getTimeline(count = 20) {
    return ready() ? requireKernel().session.getTimeline(count) : [];
  }

  async function getSnapshot() {
    return ready() ? requireKernel().context.snapshot() : { units: [] };
  }

  function getUsage() {
    return kernel?.metrics?.getUsage?.() || kernel?.modelGateway?.getUsageStats?.() || zeroUsage();
  }

  function getConfig() {
    return ready() ? requireKernel().config.getPublicConfig() : {};
  }

  function getState() {
    return ready() ? requireKernel().runtime.getState() : { current: "idle", channel: null };
  }

  async function listBranches() {
    return ready() ? requireKernel().session.branches?.list?.() || [] : [];
  }

  async function getActiveBranch() {
    return ready() ? requireKernel().session.branches?.getActive?.() || { branch_id: "br_main" } : { branch_id: "br_main" };
  }

  async function listCheckpoints(options = {}) {
    return ready() ? requireKernel().session.checkpoints?.list?.(options) || [] : [];
  }

  async function rewindPreview(options = {}) {
    return requireKernel().session.rewind.preview(options);
  }

  async function rewindApply(options = {}) {
    return requireKernel().session.rewind.apply(options);
  }

  async function getPreferences() {
    return loadGuiPreferences(projectRoot);
  }

  async function setPreferences(patch = {}) {
    return saveGuiPreferences(projectRoot, patch);
  }

  async function listTree() {
    const { walkWorkspaceFiles } = await loadPathSafety();
    return walkWorkspaceFiles(projectRoot);
  }

  async function readFile(rel) {
    const { readWorkspaceTextFile } = await loadPathSafety();
    const r = await readWorkspaceTextFile(projectRoot, rel);
    return { ...r, language: languageForExt(rel) };
  }

  // A standalone edit service for GUI saves. It is intentionally NOT the kernel's own
  // (that one is wired with recoveryJournal/assertOwner for agent turns); GUI saves are
  // synchronous user actions. Still transactional + boundary-checked + change-recorded.
  async function getGuiEditService() {
    if (guiEditService) return guiEditService;
    const { createEditService } = await loadEditServiceMod();
    guiEditService = createEditService({
      projectRoot,
      eventBus: { publish: (type, data) => pushEvent({ type, ...(data || {}) }) }
    });
    return guiEditService;
  }

  async function writeFile(rel, content) {
    const { readWorkspaceTextFile } = await loadPathSafety();
    let before = "";
    try {
      const cur = await readWorkspaceTextFile(projectRoot, rel);
      before = cur.content;
    } catch (error) {
      return { error: error.message };   // missing / binary / outside workspace → refuse
    }
    const { wholeFileDiff } = await loadSaveDiffMod();
    const diff = wholeFileDiff(rel, before, String(content ?? ""));
    if (!diff) return { ok: true, unchanged: true };
    const svc = await getGuiEditService();
    const result = await svc.apply({ diff, prompt: `GUI edit ${rel}` });
    return { ok: true, result };
  }

  // D-4 read-only change-tracking bridge. Reads .deepseek-code/changes/ via the
  // kernel's own change-store (never writes); full before/after texts only leave
  // the main process one file at a time (describeChange slice).
  let changeStore = null;
  async function getChangeStore() {
    if (!changeStore) {
      const { createChangeStore } = await loadChangeStoreMod();
      changeStore = createChangeStore({ projectRoot });
    }
    return changeStore;
  }

  async function readRolledBackIds() {
    try {
      const raw = await fs.readFile(path.join(projectRoot, ".deepseek-code", "rollbacks.jsonl"), "utf8");
      const ids = new Set();
      for (const line of raw.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) continue;
        try { const j = JSON.parse(s); if (j && j.id) ids.add(j.id); } catch { /* skip bad line */ }
      }
      return ids;
    } catch { return new Set(); }
  }

  function diffFileStats(parseUnifiedDiff, diff) {
    const map = new Map();
    try {
      for (const patch of parseUnifiedDiff(String(diff || ""))) {
        const p = patch.newPath === "/dev/null" ? patch.oldPath : patch.newPath;
        let added = 0, removed = 0;
        const hunkStarts = [];
        for (const h of patch.hunks || []) {
          hunkStarts.push(h.newStart);
          for (const l of h.lines || []) {
            if (l.type === "+") added += 1;
            else if (l.type === "-") removed += 1;
          }
        }
        map.set(p, { added, removed, hunkStarts });
      }
    } catch { return new Map(); }
    return map;
  }

  function slimFile(f, stats) {
    const s = stats.get(f.path) || null;
    return {
      path: f.path,
      status: f.status,
      added: s ? s.added : null,
      removed: s ? s.removed : null,
      hunkStarts: s ? s.hunkStarts : null
    };
  }

  async function listChanges(opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
    const store = await getChangeStore();
    const { parseUnifiedDiff } = await loadPatchMod();
    const [records, rolledBack] = await Promise.all([store.list({ limit }), readRolledBackIds()]);
    return records.map((r) => {
      const stats = diffFileStats(parseUnifiedDiff, r.diff);
      return {
        id: r.id,
        time: r.time,
        prompt: r.prompt || "",
        rolledBack: rolledBack.has(r.id),
        files: (r.files || []).map((f) => slimFile(f, stats))
      };
    });
  }

  async function describeChange(changeId, relPath) {
    const store = await getChangeStore();
    const { parseUnifiedDiff } = await loadPatchMod();
    const record = await store.describe({ change_id: changeId || "latest" });
    const files = record.files || [];
    const file = relPath ? files.find((f) => f.path === relPath) : files[0];
    if (!file) throw new Error(`change ${record.id}: file not found: ${relPath || "(first)"}`);
    const stats = diffFileStats(parseUnifiedDiff, record.diff);
    const s = stats.get(file.path) || null;
    const rolledBack = (await readRolledBackIds()).has(record.id);
    return {
      id: record.id,
      time: record.time,
      prompt: record.prompt || "",
      rolledBack,
      file: {
        path: file.path,
        status: file.status,
        before: typeof file.before === "string" ? file.before : null,
        after: typeof file.after === "string" ? file.after : null,
        language: languageForExt(file.path),
        added: s ? s.added : null,
        removed: s ? s.removed : null,
        hunkStarts: s ? s.hunkStarts : null
      }
    };
  }

  const apiProfiles = (() => {
    let promise = null;
    const load = () => {
      if (!promise) promise = loadApiProfilesMod().then((m) => m.createApiProfiles({ dir: path.join(projectRoot, ".deepseek-code") }));
      return promise;
    };
    return {
      list: async () => (await load()).list(),
      save: async (p) => (await load()).save(p),
      remove: async (id) => (await load()).remove(id),
      activate: async (id) => (await load()).activate(id),
      getActive: async () => (await load()).getActive()
    };
  })();

  async function getSettings() {
    const prefs = await loadGuiPreferences(projectRoot);
    let config = { hasApiKey: false };
    try { const m = await loadConfigMod(); config = maskConfig(await m.loadConfig(projectRoot, { allowMissingKey: true })); } catch { /* keep default */ }
    const profiles = (await apiProfiles.list()).map(maskProfile);
    const active = await apiProfiles.getActive();
    return { prefs, config, apiProfiles: profiles, activeProfileId: active ? active.id : null };
  }
  async function setConfig(patch = {}) {
    const m = await loadConfigMod();
    const { config } = await m.configureProject(projectRoot, patch);
    return maskConfig(config);
  }
  async function listApiProfiles() { return (await apiProfiles.list()).map(maskProfile); }
  async function saveApiProfile(p) { return maskProfile(await apiProfiles.save(p)); }
  async function deleteApiProfile(id) { await apiProfiles.remove(id); return { ok: true }; }
  async function activateApiProfile(id) {
    const prof = await apiProfiles.activate(id);
    const m = await loadConfigMod();
    await m.configureProject(projectRoot, { apiKey: prof.apiKey, baseUrl: prof.baseUrl, ...(prof.model ? { model: prof.model } : {}) });
    return maskProfile(prof);
  }
  async function listModels(profileId, opts = {}) {
    let baseUrl = opts.baseUrl;
    let apiKey = opts.apiKey;
    if (!baseUrl || !apiKey) {
      const prof = profileId ? (await apiProfiles.list()).find((p) => p.id === profileId) : await apiProfiles.getActive();
      baseUrl = baseUrl || (prof && prof.baseUrl);
      apiKey = apiKey || (prof && prof.apiKey);
    }
    if (!apiKey) throw new Error("no API key configured");
    const url = `${String(baseUrl || "https://api.deepseek.com").replace(/\/+$/, "")}/models`;
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      const detail = res.text ? await res.text().catch(() => "") : "";
      throw new Error(`models fetch failed: ${res.status} ${detail}`.trim());
    }
    const body = await res.json();
    return (body.data || []).map((m) => m.id).filter(Boolean);
  }
  async function testConnection(profileId) {
    const prof = profileId ? (await apiProfiles.list()).find((p) => p.id === profileId) : await apiProfiles.getActive();
    const m = await loadProviderMod();
    return m.testDeepSeekConnection({ apiKey: prof && prof.apiKey, baseUrl: prof && prof.baseUrl });
  }
  async function activateBranch(id) {
    const k = requireKernel();
    return (k.session.branches && k.session.branches.activate) ? k.session.branches.activate(id) : { error: "branches unavailable" };
  }

  function dispose() {
    subscription?.unsubscribe?.();
    subscription = null;
  }

  return { init, ready, send, approve, interrupt, getTimeline, getSnapshot, getUsage, getConfig, getState,
           listBranches, listCheckpoints, rewindPreview, rewindApply, getActiveBranch,
           getPreferences, setPreferences, listTree, readFile, writeFile, listChanges, describeChange,
           getSettings, setConfig, listApiProfiles, saveApiProfile, deleteApiProfile, activateApiProfile,
           listModels, testConnection, activateBranch, dispose };
}

module.exports = { createKernelHost, resolveProjectRoot, zeroUsage, buildKernelOptions,
  normalizeGuiPreferences, loadGuiPreferences, saveGuiPreferences };
