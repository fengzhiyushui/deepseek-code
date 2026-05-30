const SAFE_METADATA_KEYS = new Set([
  "path",
  "bytes",
  "argv",
  "exit_code",
  "signal",
  "change_id",
  "approval_id",
  "summary",
  "files",
  "diff_hash",
  "diff_size",
  "permission",
  "approval"
]);

export function toolResultToMessage(result, options = {}) {
  const summary = summarizeToolResult(result, options);
  return {
    role: "tool",
    tool_call_id: result.call_id,
    content: JSON.stringify({
      status: result.status,
      text: summary.text,
      metadata: summary.metadata,
      truncated: summary.truncated
    })
  };
}

export function toolResultsToMessages(results = [], options = {}) {
  return results.map((result) => toolResultToMessage(result, options));
}

export function summarizeToolResult(result, { maxContentChars = 2000, maxMetadataChars = 1200 } = {}) {
  const text = (result.content || []).map((item) => item.text || "").join("\n").slice(0, maxContentChars);
  const originalText = (result.content || []).map((item) => item.text || "").join("\n");
  const metadata = compactMetadata(result.metadata || {}, maxMetadataChars);
  return {
    text,
    metadata,
    truncated: originalText.length > maxContentChars
  };
}

function compactMetadata(metadata, maxChars) {
  const result = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    const encoded = JSON.stringify(value);
    if (encoded && encoded.length <= maxChars) result[key] = value;
  }
  return result;
}
