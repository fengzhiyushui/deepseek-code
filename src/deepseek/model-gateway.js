import { routeModel, buildChannelParams, removeUndefined } from "./model-router.js";
import { applyJsonMode } from "./json-mode.js";
import { createUsageTracker } from "./usage-tracker.js";
import { createDeepSeekApiError, isRetryableDeepSeekError } from "./api-errors.js";
import { readDeepSeekStream } from "./streaming.js";
import { createFimClient } from "./fim-client.js";
import { normalizeToolCalls } from "./tool-call-repair.js";
import { assembleReplyMessages } from "./prompt-assembler.js";

export function createDeepSeekGateway({ apiKey = process.env.DEEPSEEK_API_KEY || "", baseUrl = "https://api.deepseek.com", fetchImpl = globalThis.fetch, userId = null } = {}) {
  const usageTracker = createUsageTracker();
  const fimClient = createFimClient({ apiKey, baseUrl, fetchImpl });

  function buildChatRequest(messages, options = {}) {
    const route = routeModel(options);
    const body = applyJsonMode({ messages, jsonMode: Boolean(options.jsonMode), body: removeUndefined({ ...buildChannelParams(options), messages, stream: Boolean(options.stream ?? route.stream), tools: options.tools, tool_choice: options.toolChoice, user_id: userId }) });
    if (body.stream) body.stream_options = { include_usage: true };
    return { url: `${baseUrl.replace(/\/+$/, "")}/chat/completions`, body, route };
  }

  async function invoke(messages, options = {}) {
    const request = buildChatRequest(messages, { ...options, stream: false });
    const started = Date.now();
    const timeout = withTimeout(options.signal, options.timeoutMs);
    let response;
    try {
      response = await fetchImpl(request.url, { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(request.body), signal: timeout.signal });
    } catch (error) {
      if (timeout.didTimeout()) throw modelTimeoutError(options.timeoutMs);
      throw error;
    } finally {
      timeout.cleanup();
    }
    const latencyMs = Date.now() - started;
    if (!response.ok) throw createDeepSeekApiError(response.status, await response.text().catch(() => ""));
    const payload = await response.json();
    const processed = processChatPayload(payload, request.route, latencyMs);
    usageTracker.recordUsage({ usage: processed.usage, channel: request.route.channel, model: request.body.model, latency_ms: latencyMs });
    if (isRetryableDeepSeekError({ finish_reason: processed.finish_reason })) processed.retryable = true;
    return processed;
  }

  async function stream(messages, options = {}) {
    const request = buildChatRequest(messages, { ...options, stream: true });
    const started = Date.now();
    const timeout = withTimeout(options.signal, options.timeoutMs);
    let response;
    try {
      response = await fetchImpl(request.url, { method: "POST", headers: authHeaders(apiKey), body: JSON.stringify(request.body), signal: timeout.signal });
    } catch (error) {
      if (timeout.didTimeout()) throw modelTimeoutError(options.timeoutMs);
      throw error;
    } finally {
      timeout.cleanup();
    }
    const latencyMs = Date.now() - started;
    if (!response.ok) throw createDeepSeekApiError(response.status, await response.text().catch(() => ""));
    const streamed = await readDeepSeekStream(response.body, { onDelta: options.onDelta, signal: timeout.signal });
    const result = { ...streamed, model: request.body.model, channel: request.route.channel, latency_ms: latencyMs, tool_calls: normalizeToolCalls(streamed.tool_calls) };
    usageTracker.recordUsage({ usage: result.usage, channel: request.route.channel, model: request.body.model, latency_ms: latencyMs });
    return result;
  }

  async function fimComplete(prefix, suffix = "", options = {}) {
    const result = await fimClient.complete({ prefix, suffix, model: options.model, maxTokens: options.maxTokens, signal: options.signal });
    usageTracker.recordUsage({ usage: result.usage, channel: "fim", model: result.model, latency_ms: result.latency_ms || 0 });
    return result.content;
  }

  async function reply({ message, classification, context, turn, options = {}, signal, onDelta } = {}) {
    const messages = assembleReplyMessages({ message, classification, context, turn, history: options.history });
    const taskType = classification?.task_type || "general";
    const purpose = taskType === "query" ? "reply" : "plan";
    const result = await invoke(messages, { purpose, signal });
    if (onDelta && result.content) onDelta(result.content);
    return result;
  }

  return { buildChatRequest, invoke, stream, fimComplete, reply, getUsageStats: usageTracker.getUsageStats };
}

function processChatPayload(payload, route, latencyMs) {
  const choice = payload.choices?.[0] || {};
  const message = choice.message || {};
  return { content: message.content || "", reasoning_content: message.reasoning_content || null, reasoning_hidden: true, tool_calls: normalizeToolCalls(message.tool_calls || []), finish_reason: choice.finish_reason || null, usage: payload.usage || null, model: payload.model || route.model, channel: route.channel, latency_ms: latencyMs };
}

function authHeaders(apiKey) { return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }; }

function withTimeout(callerSignal, timeoutMs) {
  if (!timeoutMs) return { signal: callerSignal, cleanup: () => {}, didTimeout: () => false };
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener("abort", onAbort);
    },
    didTimeout: () => timedOut
  };
}

function modelTimeoutError(timeoutMs) {
  const err = new Error(`model request timed out after ${timeoutMs}ms`);
  err.code = "MODEL_TIMEOUT";
  return err;
}
