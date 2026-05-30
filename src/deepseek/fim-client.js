import { createDeepSeekApiError } from "./api-errors.js";

export function buildFimRequest({ prefix, suffix = "", model = "deepseek-v4-flash", maxTokens = 512 } = {}) {
  if (typeof prefix !== "string" || prefix.length === 0) throw new Error("FIM prefix must be a non-empty string");
  return removeUndefined({ model, prompt: prefix, suffix, max_tokens: maxTokens });
}

export function createFimClient({ apiKey, baseUrl = "https://api.deepseek.com", fetchImpl = globalThis.fetch } = {}) {
  async function complete({ prefix, suffix = "", model, maxTokens, signal } = {}) {
    const body = buildFimRequest({ prefix, suffix, model, maxTokens });
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/beta/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) throw createDeepSeekApiError(response.status, await response.text().catch(() => ""));
    const payload = await response.json();
    return { content: payload.choices?.[0]?.text || "", usage: payload.usage || null, model: body.model, channel: "fim" };
  }
  return { complete };
}

function removeUndefined(record) { return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)); }
