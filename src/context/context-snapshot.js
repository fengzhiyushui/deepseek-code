import { makeId } from "../shared/id.js";

export function buildContextSnapshot({
  root,
  channel = "reply",
  taskType = "general",
  selected = [],
  budget = { allocated: 0, used: 0, remaining: 0 },
  stats = {}
} = {}) {
  const units = selected.map((unit) => ({
    id: unit.id,
    path: unit.path,
    hash: unit.hash,
    token_count: unit.token_count,
    priority: unit.priority,
    reason: unit.reason
  }));
  const assemblyOrder = units.map((unit) => unit.path);
  const stablePrefixUnits = selected.filter((unit) => unit.priority === 0);

  return {
    snapshot_id: makeId("ctxsnap"),
    root,
    channel,
    task_type: taskType,
    summary: buildSummary(selected),
    units,
    unit_hashes: units.map((unit) => unit.hash),
    file_revision_hashes: Object.fromEntries(units.map((unit) => [unit.path, unit.hash])),
    assembly_order: assemblyOrder,
    expected_cache_prefix_offset: stablePrefixUnits.reduce((sum, unit) => sum + unit.token_count, 0),
    budget,
    stats: {
      indexed_files: stats.indexed_files || 0,
      skipped_files: stats.skipped_files || 0,
      selected_files: units.length
    }
  };
}

export function buildSummary(selected = []) {
  if (!selected.length) return "Project files:\n(none selected)";

  const files = selected.map((unit) => `- ${unit.path} (P${unit.priority} ${unit.reason})`);
  const snippets = selected.map((unit) => [
    `--- ${unit.path}`,
    unit.snippet || ""
  ].join("\n"));
  return [
    "Project files:",
    ...files,
    "",
    "Relevant snippets:",
    ...snippets
  ].join("\n");
}
