// gui/kernel-host.js
const path = require("path");
const { pathToFileURL } = require("url");

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
  return {
    ...overrides,
    deepseek: {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    }
  };
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
    k.agent.send(message, opts).then((result) => {
      pushEvent({ type: "agent:result", result: result || { status: "complete" } });
    }).catch((error) => {
      pushEvent({ type: "agent:error", error: error.message });
    });
    return { ok: true };
  }

  function approve(id, decision) {
    requireKernel().agent.approve(id, decision);
    return { ok: true };
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
    return kernel?.modelGateway?.getUsageStats?.() || kernel?.metrics?.getUsage?.() || zeroUsage();
  }

  function getConfig() {
    return ready() ? requireKernel().config.getPublicConfig() : {};
  }

  function getState() {
    return ready() ? requireKernel().runtime.getState() : { current: "idle", channel: null };
  }

  function dispose() {
    subscription?.unsubscribe?.();
    subscription = null;
  }

  return { init, ready, send, approve, interrupt, getTimeline, getSnapshot, getUsage, getConfig, getState, dispose };
}

module.exports = { createKernelHost, resolveProjectRoot, zeroUsage, buildKernelOptions };
