// gui/kernel-host.js
const fs = require("fs/promises");
const path = require("path");
const { pathToFileURL } = require("url");

const GUI_PREFERENCE_DEFAULTS = Object.freeze({
  schema: 1,
  theme: "night",
  railMode: "chat",
  contextCollapsed: false
});

const GUI_RAIL_MODES = new Set(["chat", "context", "branches", "timeline", "settings"]);

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
  pushEvent = () => {}
} = {}) {
  let kernel = null;
  let subscription = null;

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

  function dispose() {
    subscription?.unsubscribe?.();
    subscription = null;
  }

  return { init, ready, send, approve, interrupt, getTimeline, getSnapshot, getUsage, getConfig, getState,
           listBranches, listCheckpoints, rewindPreview, rewindApply, getActiveBranch,
           getPreferences, setPreferences, dispose };
}

module.exports = { createKernelHost, resolveProjectRoot, zeroUsage, buildKernelOptions,
  normalizeGuiPreferences, loadGuiPreferences, saveGuiPreferences };
