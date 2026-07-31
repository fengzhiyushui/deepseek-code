import http from "node:http";
import https from "node:https";
import { resolveFetchTarget } from "../../security/ssrf.js";

// 工具对外文本上限;网络层同步按此截断缓冲,避免恶意大响应撑爆内存。
export const WEB_FETCH_MAX_BODY_BYTES = 32000;

export function createWebFetchTool({ fetchImpl = null, lookup } = {}) {
  return {
    name: "web_fetch",
    description: "Fetch a public HTTP or HTTPS URL with SSRF protection",
    category: "network",
    side_effect: "network",
    risk_level: "medium",
    source: "builtin",
    version: "2.1",
    params: { url: { type: "string", description: "Public URL to fetch" } },
    execute: async (params) => {
      let current = params.url;
      let redirects = 0;
      while (redirects <= 5) {
        const target = await resolveFetchTarget(current, { lookup });
        const options = {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "inkstone/1.1",
            // pinnedFetch 当前返回原始字节;请求 identity 避免把压缩响应当文本。
            "Accept-Encoding": "identity"
          },
          signal: AbortSignal.timeout(10000),
          validatedAddress: target.address,
          maxBodyBytes: WEB_FETCH_MAX_BODY_BYTES
        };
        // 默认网络路径用已验证 IP 直连,杜绝校验后再次 DNS 解析。
        // fetchImpl 仅用于测试/显式注入,并收到 validatedAddress 供自定义实现固定连接。
        const response = fetchImpl
          ? await fetchImpl(target.url.href, options)
          : await pinnedFetch(target.url, target.address, options);
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get?.("location");
          if (!location) break;
          current = new URL(location, target.url.href).href;
          redirects++;
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const capped = text.slice(0, WEB_FETCH_MAX_BODY_BYTES);
        return {
          content: [{ type: "text", text: capped }],
          metadata: {
            status: response.status,
            content_type: response.headers.get?.("content-type") || null,
            // 注入 fetchImpl 时可能无 originalLength;退回实际文本长度。
            original_length: Number.isFinite(response.originalLength) ? response.originalLength : text.length,
            redirects_followed: redirects
          }
        };
      }
      throw new Error("too many redirects");
    }
  };
}

function pinnedFetch(url, address, { method, headers, signal, maxBodyBytes = WEB_FETCH_MAX_BODY_BYTES }) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method,
      headers,
      signal,
      // 保留原 hostname 用于 Host 与 TLS SNI/证书校验,只把 socket 目标固定为已验证 IP。
      lookup(_hostname, options, callback) {
        // Node 20+ 的 autoSelectFamily 可能以 all:true 请求记录数组;两种签名都支持。
        if (options?.all) callback(null, [{ address, family: 4 }]);
        else callback(null, address, 4);
      }
    }, (response) => {
      const status = response.statusCode || 0;
      const headersView = { get: (name) => headerValue(response.headers, name) };
      // 重定向 / 非 2xx 只需要 status+headers;丢弃 body,避免大响应占内存。
      if (status < 200 || status >= 300) {
        response.resume();
        response.on("end", () => {
          resolve({
            ok: false,
            status,
            headers: headersView,
            originalLength: 0,
            text: async () => ""
          });
        });
        response.on("error", reject);
        return;
      }

      collectCappedBody(response, maxBodyBytes)
        .then(({ text, originalLength }) => {
          resolve({
            ok: true,
            status,
            headers: headersView,
            originalLength,
            text: async () => text
          });
        })
        .catch(reject);
    });
    request.on("error", reject);
    request.end();
  });
}

// 从可读流按上限收集 body;超过部分丢弃但继续 drain 以正确结束响应。
export function collectCappedBody(stream, maxBodyBytes = WEB_FETCH_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let stored = 0;
    let total = 0;
    stream.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (stored >= maxBodyBytes) return;
      const room = maxBodyBytes - stored;
      chunks.push(buf.length <= room ? buf : buf.subarray(0, room));
      stored += Math.min(buf.length, room);
    });
    stream.on("end", () => {
      resolve({
        text: Buffer.concat(chunks).toString("utf8"),
        originalLength: total
      });
    });
    stream.on("error", reject);
  });
}

function headerValue(headers, name) {
  const value = headers[String(name).toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : (value ?? null);
}
