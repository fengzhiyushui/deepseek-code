export const DEFAULT_MODELS = {
  act: "deepseek-v4-flash",
  think: "deepseek-v4-pro",
  fim: "deepseek-v4-pro"
};

const CHANNELS = {
  reply: { purpose: "reply", channel: "act", thinking: { type: "disabled" }, temperature: 0.2, max_tokens: 4096, stream: true },
  act: { purpose: "act", channel: "act", thinking: { type: "disabled" }, temperature: 0.1, max_tokens: 4096, stream: true },
  plan: { purpose: "plan", channel: "think", thinking: { type: "enabled" }, reasoning_effort: "high", temperature: 0.2, max_tokens: 8192, stream: false },
  review: { purpose: "review", channel: "think", thinking: { type: "enabled" }, reasoning_effort: "high", temperature: 0.2, max_tokens: 8192, stream: false },
  repair: { purpose: "repair", channel: "think", thinking: { type: "enabled" }, reasoning_effort: "high", temperature: 0.1, max_tokens: 8192, stream: false },
  fim: { purpose: "fim", channel: "fim", max_tokens: 512 }
};

export function routeModel({ purpose = "reply", complexity = "normal", explicitModel = null, models } = {}) {
  const key = purpose === "reply" && complexity === "high" ? "plan" : purpose;
  const profile = CHANNELS[key];
  if (!profile) throw new Error(`unknown DeepSeek purpose: ${purpose}`);
  const m = { ...DEFAULT_MODELS, ...models };
  return removeUndefined({ ...profile, purpose, model: explicitModel || m[profile.channel] });
}

export function buildChannelParams(input = {}) {
  const route = routeModel(input);
  return removeUndefined({ model: route.model, thinking: route.thinking, reasoning_effort: route.reasoning_effort, temperature: route.temperature, max_tokens: route.max_tokens });
}

export function removeUndefined(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
