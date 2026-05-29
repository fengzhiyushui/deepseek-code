// src/kernel/config-provider.js
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MODEL_PROFILES = {
  reasoning: {
    profile: "reasoning",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    default: "deepseek-v4-pro",
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    resolve() {
      return this.models[0] || this.default;
    }
  },
  fast: {
    profile: "fast",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    default: "deepseek-v4-flash",
    thinking: { type: "disabled" },
    reasoning_effort: null,
    resolve() {
      return this.models[0] || this.default;
    }
  },
  fim: {
    profile: "fim",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    default: "deepseek-v4-pro",
    thinking: { type: "disabled" },
    reasoning_effort: null,
    resolve() {
      return this.models[0] || this.default;
    }
  }
};

export const DEFAULT_CONFIG = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 4096,
  thinking: { type: "disabled" },
  reasoningEffort: "high",
  profiles: DEFAULT_MODEL_PROFILES
};

export async function loadConfig(root, options = {}) {
  const localPath = path.join(root, ".deepseek-code", "config.json");
  const homePath = path.join(os.homedir(), ".deepseek-code", "config.json");
  const fileConfig = {
    ...(await readJsonIfExists(homePath)),
    ...(await readJsonIfExists(localPath))
  };

  if (fileConfig.profiles !== undefined && (typeof fileConfig.profiles !== "object" || Array.isArray(fileConfig.profiles))) {
    delete fileConfig.profiles;
  }

  const profiles = deepMergeProfiles(DEFAULT_MODEL_PROFILES, fileConfig.profiles);

  const config = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    profiles,
    apiKey: process.env.DEEPSEEK_API_KEY || fileConfig.apiKey || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || fileConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: process.env.DEEPSEEK_MODEL || fileConfig.model || DEFAULT_CONFIG.model,
    thinking: normalizeThinking(fileConfig.thinking ?? DEFAULT_CONFIG.thinking),
    reasoningEffort: normalizeReasoningEffort(
      process.env.DEEPSEEK_REASONING_EFFORT || fileConfig.reasoningEffort || DEFAULT_CONFIG.reasoningEffort
    )
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
  const { profiles, ...persisted } = config;
  await fs.writeFile(target, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
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
    profiles: deepMergeProfiles(DEFAULT_MODEL_PROFILES, config.profiles)
  };
}

// -- internal helpers --

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`读取 ${file} 失败：${error.message}`);
  }
}

function normalizeThinking(value) {
  if (value === true || value === "enabled") return { type: "enabled" };
  if (value === false || value === "disabled" || value === undefined || value === null) {
    return { type: "disabled" };
  }
  if (typeof value === "object" && value.type) {
    return { type: value.type === "enabled" ? "enabled" : "disabled" };
  }
  return DEFAULT_CONFIG.thinking;
}

function normalizeReasoningEffort(value) {
  if (value === "max" || value === "xhigh") return "max";
  if (value === "minimal") return "minimal";
  if (["low", "medium", "high"].includes(value)) return "high";
  return DEFAULT_CONFIG.reasoningEffort;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function deepMergeProfiles(defaults, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return { ...defaults };
  }
  const merged = {};
  for (const key of Object.keys(defaults)) {
    if (overrides[key] && typeof overrides[key] === "object" && !Array.isArray(overrides[key]) && typeof overrides[key].resolve !== "function") {
      merged[key] = { ...defaults[key], ...overrides[key] };
    } else {
      merged[key] = overrides[key] !== undefined ? overrides[key] : defaults[key];
    }
  }
  return merged;
}
