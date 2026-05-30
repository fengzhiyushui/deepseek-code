const SECRET_PATTERNS = [
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /(api[_-]?key\s*=\s*)[^\s]+/gi,
  /(deepseek_api_key\s*=\s*)[^\s]+/gi
];

export function redactSecrets(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "$1[REDACTED]");
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
