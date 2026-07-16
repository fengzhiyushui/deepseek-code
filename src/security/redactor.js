const SECRET_PATTERNS = [
  // Header / assignment forms:保留键名,替换值。
  { pattern: /(authorization:\s*bearer\s+)[^\s]+/gi, replacement: "$1[REDACTED]" },
  // JSON/对象序列化形态:保留引号,使脱敏后仍是合法 JSON。
  { pattern: /("(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)"\s*:\s*")[^"]+("\s*[},]?)/gi, replacement: "$1[REDACTED]$2" },
  { pattern: /((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*)["']?[^\s"',;}]+["']?/gi, replacement: "$1[REDACTED]" },

  // 确定性 token 前缀(不做通用高熵猜测,避免误伤 hash/base64/源码常量)。
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED]" },            // AWS access key id
  { pattern: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9_]{20,255}\b/g, replacement: "[REDACTED]" }, // GitHub tokens
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,255}\b/g, replacement: "[REDACTED]" },     // DeepSeek/OpenAI-style keys

  // 私钥块跨行脱敏。保留类型标签,去掉全部正文。
  {
    pattern: /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    replacement: "-----BEGIN $1-----\n[REDACTED]\n-----END $1-----"
  }
];

export function redactSecrets(value) {
  let text;
  if (typeof value === "string") text = value;
  else {
    try {
      const serialized = JSON.stringify(value);
      text = serialized === undefined ? String(value) : serialized;
    } catch {
      text = String(value);
    }
  }
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function redactToolContent(content = []) {
  return content.map((part) => {
    if (!part || typeof part !== "object") return part;
    if (typeof part.text !== "string") return part;
    return { ...part, text: redactSecrets(part.text) };
  });
}
