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
  const homeConfig = await readJsonIfExists(homePath);
  const localConfig = await readJsonIfExists(localPath);

  // Deep-merge: defaults < home < local
  const merged = deepMergeConfig(
    deepMergeConfig(DEFAULT_CONFIG, homeConfig),
    localConfig
  );

  // Clean up invalid profiles on merged (defensive)
  if (merged.profiles !== undefined && (typeof merged.profiles !== "object" || Array.isArray(merged.profiles))) {
    delete merged.profiles;
  }

  // Merge profiles in sequence: DEFAULT -> home -> local (each level deep-merges)
  let profiles = { ...DEFAULT_MODEL_PROFILES };
  if (homeConfig.profiles && typeof homeConfig.profiles === "object" && !Array.isArray(homeConfig.profiles)) {
    profiles = deepMergeProfiles(profiles, homeConfig.profiles);
  }
  if (localConfig.profiles && typeof localConfig.profiles === "object" && !Array.isArray(localConfig.profiles)) {
    profiles = deepMergeProfiles(profiles, localConfig.profiles);
  }

  const { profiles: _, ...mergedWithoutProfiles } = merged;

  const config = {
    ...mergedWithoutProfiles,
    profiles,
    apiKey: process.env.DEEPSEEK_API_KEY || merged.apiKey || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || merged.baseUrl || DEFAULT_CONFIG.baseUrl,
    model: process.env.DEEPSEEK_MODEL || merged.model || DEFAULT_CONFIG.model,
    thinking: normalizeThinking(merged.thinking ?? DEFAULT_CONFIG.thinking),
    reasoningEffort: normalizeReasoningEffort(
      process.env.DEEPSEEK_REASONING_EFFORT || merged.reasoningEffort || DEFAULT_CONFIG.reasoningEffort
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

  // Never persist the API key if it was sourced from an environment variable.
  // Check: if an env key exists and matches the current config value,
  // remove it from persisted config so the env var remains the source of truth.
  if (process.env.DEEPSEEK_API_KEY && persisted.apiKey === process.env.DEEPSEEK_API_KEY) {
    delete persisted.apiKey;
  }

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

function deepMergeConfig(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return { ...base };
  }
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = result[key];
    const overrideVal = override[key];
    if (
      baseVal && typeof baseVal === "object" && !Array.isArray(baseVal) &&
      overrideVal && typeof overrideVal === "object" && !Array.isArray(overrideVal) &&
      key !== "profiles"  // profiles use deepMergeProfiles separately
    ) {
      result[key] = { ...baseVal, ...overrideVal };
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

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
  if (!value) return DEFAULT_CONFIG.reasoningEffort;
  if (value === "xhigh") return "max";
  const valid = new Set(["minimal", "low", "medium", "high", "max"]);
  if (valid.has(value)) return value;
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
  const allKeys = new Set([...Object.keys(defaults), ...Object.keys(overrides)]);
  for (const key of allKeys) {
    const defVal = defaults[key];
    const ovrVal = overrides[key];
    if (ovrVal && typeof ovrVal === "object" && !Array.isArray(ovrVal) && typeof ovrVal.resolve !== "function") {
      // Deep-merge: overlay override properties onto defaults (or onto {} if no default)
      merged[key] = { ...(defVal || {}), ...ovrVal };
    } else if (ovrVal !== undefined) {
      // Override replaces entirely (e.g., a string or array value)
      merged[key] = ovrVal;
    } else {
      // No override — keep default
      merged[key] = defVal;
    }
  }
  return merged;
}
