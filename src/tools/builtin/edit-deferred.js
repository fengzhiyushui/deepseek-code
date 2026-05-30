export function createDeferredEditTools({ editService = null } = {}) {
  return [
    deferred("diff_preview", "Preview a unified diff without writing files", "read", { diff: { type: "string" } }, editService, "preview"),
    deferred("diff_apply", "Apply an approved unified diff", "write_update", { diff: { type: "string" } }, editService, "apply"),
    deferred("diff_rollback", "Rollback a previous change", "write_update", { change_id: { type: "string" } }, editService, "rollback"),
    deferred("edit", "Apply a unified diff through the edit service", "write_update", { diff: { type: "string" } }, editService, "apply")
  ];
}

function deferred(name, description, category, params, editService, method) {
  return {
    name,
    description,
    category,
    side_effect: category === "read" ? "none" : "filesystem",
    risk_level: category === "read" ? "low" : "medium",
    source: "builtin",
    version: "2.0",
    params,
    execute: async (toolParams) => {
      if (!editService) throw new Error("Edit service is not configured for V2-2");
      return editService[method](toolParams);
    }
  };
}
