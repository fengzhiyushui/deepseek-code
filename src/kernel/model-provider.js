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

  function channelParams(channel, explicitModel) {
    const channelCfg = CHANNEL_CONFIGS[channel];
    if (!channelCfg) throw new Error(`Unknown channel: ${channel}`);

    const profile = profiles[channelCfg.profile];
    // Priority: per-call explicit model > profile.resolve() > channel default
    const model = explicitModel
      || profile?.resolve()
      || channelCfg.model;

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

  function buildRequestBody(messages, channel, explicitModel) {
    const base = channelParams(channel, explicitModel);
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

  function fimParams(prefix, suffix, explicitModel) {
    if (!supportsFIM()) throw new Error("FIM not supported by current config");
    const model = explicitModel || profiles.fim.resolve();
    return removeUndefined({
      model,
      prompt: prefix,
      suffix: suffix,
      max_tokens: FIM_CHANNEL_CONFIG.max_tokens,
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

  async function invoke(messages, channel, explicitModel) {
    const body = buildRequestBody(messages, channel, explicitModel);
    // invoke() is non-streaming — force stream:false even if the channel
    // default is stream:true (e.g., Act). Streaming responses are SSE,
    // which response.json() cannot parse.
    body.stream = false;
    delete body.stream_options;
    const url = buildUrl("/chat/completions");

    const startTime = Date.now();
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new Error(formatApiError(response.status, text));
      err.status = response.status;
      throw err;
    }

    const payload = await response.json();
    const processed = processResponse(payload, channel);
    processed.latency_ms = latencyMs;
    processed.model = body.model;

    if (processed.usage) {
      trackUsage({ usage: processed.usage, channel, model: body.model, latency_ms: latencyMs });
    }

    return processed;
  }

  async function streamDelta(messages, channel, onDelta, explicitModel) {
    const body = buildRequestBody(messages, channel, explicitModel);
    // Force stream:true
    body.stream = true;
    body.stream_options = { include_usage: true };

    const url = buildUrl("/chat/completions");
    const startTime = Date.now();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new Error(formatApiError(response.status, text));
      err.status = response.status;
      throw err;
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = null;
    let reasoningContent = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);
          if (event.usage) usage = event.usage;

          const delta = event.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            if (onDelta) onDelta(delta.content);
          }
          if (delta?.reasoning_content) {
            reasoningContent = (reasoningContent || "") + delta.reasoning_content;
          }
        } catch {
          // Malformed SSE chunk — skip this line but continue processing.
          // The partial content is preserved in `content` and `reasoningContent`.
          // Common cause: network corruption, proxy interference, or API edge cases.
        }
      }
    }

    const latencyMs = Date.now() - startTime;

    // Build response from streamed content
    const result = {
      content,
      reasoning_content: reasoningContent,
      _reasoning_hidden: true,
      usage,
      channel,
      model: body.model,
      latency_ms: latencyMs
    };

    if (usage) {
      trackUsage({ usage, channel, model: body.model, latency_ms: latencyMs });
    }

    return result;
  }

  async function fimComplete(prefix, suffix, explicitModel) {
    if (!supportsFIM()) throw new Error("FIM not supported by current config");

    const body = fimParams(prefix, suffix, explicitModel);
    const url = buildUrl("/completions");
    const startTime = Date.now();

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const err = new Error(formatApiError(response.status, text));
      err.status = response.status;
      throw err;
    }

    const payload = await response.json();
    const completion = payload.choices?.[0]?.text || "";

    if (payload.usage) {
      trackUsage({ usage: payload.usage, channel: "fim", model: body.model, latency_ms: latencyMs });
    }

    return completion;
  }

  function buildUrl(path) {
    const base = config.baseUrl.replace(/\/+$/, "");
    return `${base}${path}`;
  }

  return {
    channelParams,
    buildRequestBody,
    supportsFIM,
    fimParams,
    trackUsage,
    getUsageStats,
    processResponse,
    invoke,
    streamDelta,
    fimComplete
  };
}

function removeUndefined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  );
}

function formatApiError(status, text) {
  try {
    const payload = JSON.parse(text);
    return payload.error?.message || payload.message || `HTTP ${status}`;
  } catch {
    return `HTTP ${status}: ${text.slice(0, 200)}`;
  }
}
