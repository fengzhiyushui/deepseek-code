import { filterToolSchemas } from "./tool-profiles.js";

export function createWorkerFactory({ createRuntime, baseToolSchemas, makeContextSnapshot }) {
  function worker(subtask) {
    return createRuntime({
      toolSchemas: () => filterToolSchemas(baseToolSchemas(), subtask.tool_profile),
      createContextSnapshot: (input) => makeContextSnapshot({ ...input, scope: subtask.context_scope || {} })
    });
  }
  function reviewerRuntime() {
    return createRuntime({
      toolSchemas: () => filterToolSchemas(baseToolSchemas(), "readonly")
    });
  }
  return { worker, reviewerRuntime };
}
