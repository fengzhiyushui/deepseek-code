const CHANNELS = {
  reply: { purpose: "reply", channel: "act", model: "deepseek-v4-flash", thinking: { type: "disabled" }, temperature: 0.2, max_tokens: 4096, stream: true },
  act: { purpose: "act", channel: "act", model: "deepseek-v4-flash", thinking: { type: "disabled" }, temperature: 0.1, max_tokens: 4096, stream: true },
  plan: { purpose: "plan", channel: "think", model: "deepseek-v4-pro", thinking: { type: "enabled" }, reasoning_effort: "high", temperature: 0.2, max_tokens: 8192, stream: false },
  review: { purpose: "review", channel: "think", model: "deepseek-v4-pro", thinking: { type: "enabled" }, reasoning_effort: "high", temperature: 0.2, max_tokens: 8192, stream: false },
  repair: { purpose: "repair", channel: "think", model: "deepseek-v4-pro", thinking: { type: "enabled" }, reasoning_effort: "high", temperature: 0.1, max_tokens: 8192, stream: false },
  fim: { purpose: "fim", channel: "fim", model: "deepseek-v4-pro", max_tokens: 512 }
};

export function routeModel({ purpose = "reply", complexity = "normal", explicitModel = null } = {}) {
  const key = purpose === "reply" && complexity === "high" ? "plan" : purpose;
  const profile = CHANNELS[key];
  if (!profile) throw new Error(`unknown DeepSeek purpose: ${purpose}`);
  return removeUndefined({ ...profile, purpose, model: explicitModel || profile.model });
}

export function buildChannelParams(input = {}) {
  const route = routeModel(input);
  return removeUndefined({ model: route.model, thinking: route.thinking, reasoning_effort: route.reasoning_effort, temperature: route.temperature, max_tokens: route.max_tokens });
}

export function removeUndefined(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
