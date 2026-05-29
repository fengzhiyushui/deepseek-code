export async function askDeepSeek(config, messages, options = {}) {
  const url = new URL("/chat/completions", stripTrailingSlash(config.baseUrl));
  const thinkingEnabled = config.thinking?.type === "enabled";
  const body = {
    model: config.model,
    messages,
    temperature: thinkingEnabled ? undefined : config.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? config.maxTokens ?? 4096,
    stream: Boolean(options.stream),
    stream_options: options.stream ? { include_usage: true } : undefined,
    thinking: config.thinking,
    reasoning_effort: thinkingEnabled ? config.reasoningEffort : undefined
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(removeUndefined(body))
  }).catch((error) => {
    throw new Error([
      "DeepSeek API 连接失败：无法访问接口地址。",
      `接口地址：${url.origin}`,
      "请检查网络连接、代理设置，或确认 DEEPSEEK_BASE_URL / baseUrl 配置正确。",
      `底层错误：${error.message}`
    ].join("\n"));
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatApiError(response.status, text));
  }

  if (body.stream) {
    return readStreamingResponse(response);
  }

  const payload = await response.json();
  return {
    content: payload.choices?.[0]?.message?.content || "",
    usage: payload.usage || null
  };
}

export async function testDeepSeekConnection(config) {
  const testConfig = {
    ...config,
    maxTokens: 8,
    thinking: { type: "disabled" }
  };
  const result = await askDeepSeek(testConfig, [
    {
      role: "system",
      content: "Reply with OK."
    },
    {
      role: "user",
      content: "ping"
    }
  ], {
    stream: false,
    maxTokens: 8
  });
  return result;
}

async function readStreamingResponse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      const event = JSON.parse(data);
      if (event.usage) {
        usage = event.usage;
      }
      const delta = event.choices?.[0]?.delta?.content || "";
      if (delta) {
        content += delta;
        process.stdout.write(delta);
      }
    }
  }

  if (content) {
    process.stdout.write("\n");
  }
  return { content, usage };
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function formatApiError(status, text) {
  const detail = parseApiError(text);
  if (status === 401) {
    return [
      "DeepSeek API 认证失败：当前 API key 无效或已失效。",
      "请在 DeepSeek 控制台重新创建密钥，然后运行：",
      "  deepseek-code config init --api-key <new-key>",
      "也可以在 TUI 中选择“配置 API 密钥”。",
      detail ? `服务端信息：${detail}` : ""
    ].filter(Boolean).join("\n");
  }
  if (status === 403) {
    return [
      "DeepSeek API 权限不足：当前 API key 没有访问该模型或接口的权限。",
      detail ? `服务端信息：${detail}` : ""
    ].filter(Boolean).join("\n");
  }
  if (status === 429) {
    return [
      "DeepSeek API 请求受限：可能是额度不足、限流或并发过高。",
      detail ? `服务端信息：${detail}` : ""
    ].filter(Boolean).join("\n");
  }
  return `DeepSeek API 请求失败 ${status}：${detail || text.slice(0, 500)}`;
}

function parseApiError(text) {
  try {
    const payload = JSON.parse(text);
    return payload.error?.message || payload.message || text.slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}
