import { loadConfig } from "../config.js";

export async function buildKernelOptions(root, overrides = {}, loadConfigImpl = loadConfig) {
  if (overrides.modelGateway || overrides.deepseek) return overrides;
  let config = {};
  try {
    config = await loadConfigImpl(root, { allowMissingKey: true });
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
