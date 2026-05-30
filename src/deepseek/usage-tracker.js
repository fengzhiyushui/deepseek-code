export function createUsageTracker() {
  const store = { requests: 0, total_prompt_tokens: 0, total_completion_tokens: 0, total_reasoning_tokens: 0, total_tokens: 0, cache_hit_tokens: 0, cache_miss_tokens: 0, total_latency_ms: 0, by_channel: {}, by_model: {} };

  function recordUsage({ usage = null, channel = "unknown", model = "unknown", latency_ms = 0 } = {}) {
    if (!usage) return;
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || promptTokens + completionTokens;
    const cacheHit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
    const cacheMiss = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
    store.requests += 1;
    store.total_prompt_tokens += promptTokens;
    store.total_completion_tokens += completionTokens;
    store.total_reasoning_tokens += reasoningTokens;
    store.total_tokens += totalTokens;
    store.cache_hit_tokens += cacheHit;
    store.cache_miss_tokens += cacheMiss;
    store.total_latency_ms += latency_ms || 0;
    bump(store.by_channel, channel, promptTokens, completionTokens, totalTokens);
    bump(store.by_model, model, promptTokens, completionTokens, totalTokens);
  }

  function getUsageStats() {
    const cacheTotal = store.cache_hit_tokens + store.cache_miss_tokens;
    return { requests: store.requests, total_prompt_tokens: store.total_prompt_tokens, total_completion_tokens: store.total_completion_tokens, total_reasoning_tokens: store.total_reasoning_tokens, total_tokens: store.total_tokens, cache_hit_tokens: store.cache_hit_tokens, cache_miss_tokens: store.cache_miss_tokens, cache_hit_rate: cacheTotal > 0 ? round(store.cache_hit_tokens / cacheTotal) : 0, avg_latency_ms: store.requests > 0 ? Math.round(store.total_latency_ms / store.requests) : 0, by_channel: clone(store.by_channel), by_model: clone(store.by_model) };
  }
  return { recordUsage, getUsageStats };
}

function bump(bucket, key, promptTokens, completionTokens, totalTokens) {
  if (!bucket[key]) bucket[key] = { requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  bucket[key].requests += 1;
  bucket[key].prompt_tokens += promptTokens;
  bucket[key].completion_tokens += completionTokens;
  bucket[key].total_tokens += totalTokens;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function round(value) { return Math.round(value * 10000) / 10000; }
