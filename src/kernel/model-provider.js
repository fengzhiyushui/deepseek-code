// src/kernel/model-provider.js

const CHANNEL_CONFIGS = {
  think: {
    profile: "reasoning",
    model: "deepseek-v4-pro",
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    temperature: undefined,
    max_tokens: 16384,
    stream: false,
    response_format: { type: "json_object" }
  },
  act: {
    profile: "fast",
    model: "deepseek-v4-flash",
    thinking: { type: "disabled" },
    reasoning_effort: undefined,
    temperature: 0.1,
    max_tokens: 4096,
    stream: true,
    response_format: undefined
  }
};

const FIM_CHANNEL_CONFIG = {
  profile: "fim",
  thinking: { type: "disabled" },
  max_tokens: 128
};

export function createModelProvider(config) {
  const profiles = config.profiles || {};
  const usageStore = {
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_reasoning_tokens: 0,
    requests: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    total_latency_ms: 0,
    by_channel: {}
  };

  function channelParams(channel) {
    const channelCfg = CHANNEL_CONFIGS[channel];
    if (!channelCfg) throw new Error(`Unknown channel: ${channel}`);

    const profile = profiles[channelCfg.profile];
    // Priority: user explicit override > profile.resolve() > channel default
    const model = config.model
      ? config.model
      : (profile?.resolve() || channelCfg.model);

    return removeUndefined({
      model,
      thinking: channelCfg.thinking,
      reasoning_effort: channelCfg.thinking?.type === "enabled"
        ? (config.reasoningEffort || channelCfg.reasoning_effort)
        : undefined,
      temperature: channelCfg.temperature,
      max_tokens: channelCfg.max_tokens,
      stream: channelCfg.stream,
      response_format: channelCfg.response_format,
    });
  }

  function buildRequestBody(messages, channel) {
    const base = channelParams(channel);
    const body = {
      model: base.model,
      messages,
      max_tokens: base.max_tokens,
      stream: Boolean(base.stream),
      thinking: base.thinking,
      reasoning_effort: base.reasoning_effort,
    };
    if (base.temperature !== undefined) body.temperature = base.temperature;
    if (base.response_format) body.response_format = base.response_format;
    if (base.stream) body.stream_options = { include_usage: true };
    return removeUndefined(body);
  }

  function supportsFIM() {
    return !!profiles.fim;
  }

  function fimParams(prefix, suffix) {
    if (!supportsFIM()) throw new Error("FIM not supported by current config");
    const model = config.model || profiles.fim.resolve();
    return removeUndefined({
      model,
      prompt: prefix,
      suffix: suffix,
      max_tokens: FIM_CHANNEL_CONFIG.max_tokens,
      thinking: FIM_CHANNEL_CONFIG.thinking,
    });
  }

  function trackUsage(record) {
    const u = record.usage || {};
    usageStore.total_prompt_tokens += u.prompt_tokens || 0;
    usageStore.total_completion_tokens += u.completion_tokens || 0;
    usageStore.total_reasoning_tokens +=
      (u.completion_tokens_details?.reasoning_tokens) || 0;
    usageStore.requests += 1;
    usageStore.cache_hit_tokens += u.prompt_cache_hit_tokens ||
      (u.prompt_tokens_details?.cached_tokens) || 0;
    usageStore.cache_miss_tokens += u.prompt_cache_miss_tokens ||
      Math.max(0, (u.prompt_tokens || 0) - (u.prompt_tokens_details?.cached_tokens || 0));
    usageStore.total_latency_ms += record.latency_ms || 0;
    const ch = record.channel || "unknown";
    if (!usageStore.by_channel[ch]) {
      usageStore.by_channel[ch] = {
        requests: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0
      };
    }
    usageStore.by_channel[ch].requests += 1;
    usageStore.by_channel[ch].total_prompt_tokens += u.prompt_tokens || 0;
    usageStore.by_channel[ch].total_completion_tokens += u.completion_tokens || 0;
  }

  function getUsageStats() {
    return {
      total_prompt_tokens: usageStore.total_prompt_tokens,
      total_completion_tokens: usageStore.total_completion_tokens,
      total_reasoning_tokens: usageStore.total_reasoning_tokens,
      requests: usageStore.requests,
      cache_hit_tokens: usageStore.cache_hit_tokens,
      cache_miss_tokens: usageStore.cache_miss_tokens,
      avg_latency_ms: usageStore.requests > 0
        ? Math.round(usageStore.total_latency_ms / usageStore.requests)
        : 0,
      by_channel: { ...usageStore.by_channel }
    };
  }

  function processResponse(response, channel) {
    const message = response.choices?.[0]?.message || {};
    return {
      content: message.content || "",
      reasoning_content: message.reasoning_content || null,
      _reasoning_hidden: true,
      usage: response.usage || null,
      channel
    };
  }

  return {
    channelParams,
    buildRequestBody,
    supportsFIM,
    fimParams,
    trackUsage,
    getUsageStats,
    processResponse
  };
}

function removeUndefined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  );
}
