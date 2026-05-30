import { makeId } from "../../shared/id.js";

export function createToolCall({
  name,
  params = {},
  source = "model",
  requestedByStepId,
  id = makeId("toolcall")
}) {
  if (!name) throw new Error("tool call name is required");
  if (!requestedByStepId) throw new Error("requestedByStepId is required");

  return {
    id,
    name,
    params,
    source,
    requested_by_step_id: requestedByStepId
  };
}
