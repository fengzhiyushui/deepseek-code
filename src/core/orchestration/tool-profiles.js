// Tool names come from src/tools/builtin/*: read ls grep glob shell test git
// web_fetch memory task ask_user diff_preview diff_apply diff_rollback edit.
const READONLY = ["read", "ls", "grep", "glob", "test", "diff_preview"];
const EDIT = [...READONLY, "edit", "diff_apply", "diff_rollback", "git"];

export const TOOL_PROFILES = {
  readonly: new Set(READONLY),
  edit: new Set(EDIT)
};

export function filterToolSchemas(schemas, profile) {
  const allow = TOOL_PROFILES[profile] || TOOL_PROFILES.readonly;
  return (schemas || []).filter((s) => allow.has(s?.function?.name));
}
