// src/apps/model-catalog.js — GET {baseUrl}/models 拉模型列表(Bearer)。不设默认、失败抛错;fetch 可注入。
export async function fetchModelIds({ baseUrl, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error("no API key configured");
  const url = `${String(baseUrl || "https://api.deepseek.com").replace(/\/+$/, "")}/models`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const detail = res.text ? await res.text().catch(() => "") : "";
    throw new Error(`models fetch failed: ${res.status} ${detail}`.trim());
  }
  const body = await res.json();
  return (body.data || []).map((m) => m.id).filter(Boolean);
}
