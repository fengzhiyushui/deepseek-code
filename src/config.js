import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 4096,
  thinking: { type: "disabled" },
  reasoningEffort: "high",
  limits: {
    toolTimeoutMs: 120000,
    modelTimeoutMs: 120000,
    maxTurnTokens: null,
    maxModelCalls: null,
    maxToolCallRepairs: null
  },
  context: {
    semantic: { enabled: false, hops: 2, maxSymbols: 200, includeMethodHints: false, languages: ["js", "ts", "py"], importRoots: [] }
  }
};

export async function loadConfig(root, options = {}) {
  const localPath = path.join(root, ".deepseek-code", "config.json");
  const homePath = path.join(os.homedir(), ".deepseek-code", "config.json");
  const fileConfig = {
    ...(await readJsonIfExists(homePath)),
    ...(await readJsonIfExists(localPath))
  };

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    apiKey: fileConfig.apiKey || process.env.DEEPSEEK_API_KEY || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || fileConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: process.env.DEEPSEEK_MODEL || fileConfig.model || DEFAULT_CONFIG.model,
    thinking: normalizeThinking(fileConfig.thinking ?? DEFAULT_CONFIG.thinking),
    reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT || fileConfig.reasoningEffort || DEFAULT_CONFIG.reasoningEffort,
    limits: limitsFromEnv(normalizeLimits(fileConfig.limits)),
    context: normalizeContext(fileConfig.context)
  };

  if (!config.apiKey && !options.allowMissingKey) {
    throw new Error("缺少 DeepSeek API 密钥。请运行 config init --api-key <key>，或设置 DEEPSEEK_API_KEY。");
  }

  return config;
}

export async function saveLocalConfig(root, config) {
  const dir = path.join(root, ".deepseek-code");
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, "config.json");
  await fs.writeFile(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return target;
}

export async function configureProject(root, updates) {
  const current = await loadConfig(root, { allowMissingKey: true });
  const config = normalizeConfig({
    ...current,
    ...updates
  });
  const target = await saveLocalConfig(root, config);
  return { target, config };
}

export function normalizeConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    baseUrl: stripTrailingSlash(config.baseUrl || DEFAULT_CONFIG.baseUrl),
    model: config.model || DEFAULT_CONFIG.model,
    apiKey: config.apiKey || "",
    temperature: toNumber(config.temperature, DEFAULT_CONFIG.temperature),
    maxTokens: Math.trunc(toNumber(config.maxTokens, DEFAULT_CONFIG.maxTokens)),
    thinking: normalizeThinking(config.thinking ?? DEFAULT_CONFIG.thinking),
    reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
    limits: normalizeLimits(config.limits),
    context: normalizeContext(config.context)
  };
}

export function normalizeLimits(raw = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_CONFIG.limits;
  return {
    toolTimeoutMs: toLimit(safe.toolTimeoutMs, d.toolTimeoutMs),
    modelTimeoutMs: toLimit(safe.modelTimeoutMs, d.modelTimeoutMs),
    maxTurnTokens: toLimit(safe.maxTurnTokens, d.maxTurnTokens),
    maxModelCalls: toLimit(safe.maxModelCalls, d.maxModelCalls),
    maxToolCallRepairs: toLimit(safe.maxToolCallRepairs, d.maxToolCallRepairs)
  };
}

export function normalizeContext(raw = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const s = safe.semantic && typeof safe.semantic === "object" ? safe.semantic : {};
  const d = DEFAULT_CONFIG.context.semantic;
  const posInt = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fb; };
  return {
    semantic: {
      enabled: s.enabled === true,
      hops: posInt(s.hops, d.hops),
      maxSymbols: posInt(s.maxSymbols, d.maxSymbols),
      includeMethodHints: s.includeMethodHints === true,
      languages: normalizeLanguages(s.languages, d.languages),
      importRoots: Array.isArray(s.importRoots) ? s.importRoots.filter((x) => typeof x === "string" && x.length > 0) : []
    }
  };
}

function normalizeLanguages(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const allow = new Set(["js", "ts", "py"]);
  const out = [];
  for (const v of value) if (allow.has(v) && !out.includes(v)) out.push(v);
  return out.length ? out : [...fallback];
}

function toLimit(value, fallback) {
  if (value === undefined) return fallback;       // 省略 → 默认
  if (value === null) return null;                // 显式关闭
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null; // 非法 / ≤0 → 关闭
  return Math.trunc(n);
}

function limitsFromEnv(limits) {
  const tool = process.env.DEEPSEEK_TOOL_TIMEOUT_MS;
  const model = process.env.DEEPSEEK_MODEL_TIMEOUT_MS;
  return {
    ...limits,
    ...(tool !== undefined ? { toolTimeoutMs: toLimit(tool, limits.toolTimeoutMs) } : {}),
    ...(model !== undefined ? { modelTimeoutMs: toLimit(model, limits.modelTimeoutMs) } : {})
  };
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw new Error(`读取 ${file} 失败：${error.message}`);
  }
}

function normalizeThinking(value) {
  if (value === true || value === "enabled") {
    return { type: "enabled" };
  }
  if (value === false || value === "disabled" || value === undefined || value === null) {
    return { type: "disabled" };
  }
  if (typeof value === "object" && value.type) {
    return { type: value.type === "enabled" ? "enabled" : "disabled" };
  }
  return DEFAULT_CONFIG.thinking;
}

function normalizeReasoningEffort(value) {
  if (value === "max" || value === "xhigh") {
    return "max";
  }
  if (value === "minimal") {
    return "minimal";
  }
  if (["low", "medium", "high"].includes(value)) {
    return "high";
  }
  return DEFAULT_CONFIG.reasoningEffort;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
