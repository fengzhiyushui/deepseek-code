import { validateFetchUrl } from "../../security/ssrf.js";

export function createWebFetchTool({ fetchImpl = globalThis.fetch, lookup } = {}) {
  return {
    name: "web_fetch",
    description: "Fetch a public HTTP or HTTPS URL with SSRF protection",
    category: "network",
    side_effect: "network",
    risk_level: "medium",
    source: "builtin",
    version: "2.0",
    params: { url: { type: "string", description: "Public URL to fetch" } },
    execute: async (params) => {
      let current = params.url;
      let redirects = 0;
      while (redirects <= 5) {
        const parsed = await validateFetchUrl(current, { lookup });
        const response = await fetchImpl(parsed.href, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": "DeepSeek-Code/2.0" },
          signal: AbortSignal.timeout(10000)
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get?.("location");
          if (!location) break;
          current = new URL(location, parsed.href).href;
          redirects++;
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        return {
          content: [{ type: "text", text: text.slice(0, 32000) }],
          metadata: {
            status: response.status,
            content_type: response.headers.get?.("content-type") || null,
            original_length: text.length,
            redirects_followed: redirects
          }
        };
      }
      throw new Error("too many redirects");
    }
  };
}
