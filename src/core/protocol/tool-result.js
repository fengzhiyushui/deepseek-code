import { makeId } from "../../shared/id.js";

export function createToolResult({
  callId,
  status,
  content = [],
  metadata = {},
  durationMs = 0,
  id = makeId("toolresult")
}) {
  if (!callId) throw new Error("callId is required");
  if (!status) throw new Error("tool result status is required");

  return {
    id,
    call_id: callId,
    status,
    content,
    metadata,
    duration_ms: durationMs
  };
}
