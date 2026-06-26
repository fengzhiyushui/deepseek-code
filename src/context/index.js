import path from "node:path";
import { budgetForChannel } from "./token-budget.js";
import { selectContextUnits } from "./context-selector.js";
import { buildContextSnapshot } from "./context-snapshot.js";
import { hydrateContextRecords, scanContextWithCache } from "./context-cache.js";
import { createSemanticEngine } from "./semantic/semantic-engine.js";

export function createContextEngine({ root, eventBus = null, options = {} } = {}) {
  if (!root) throw new Error("root is required");
  const disabled = options.disabled === true;
  let records = new Map();
  let stats = { indexed_files: 0, skipped_files: 0, reused_files: 0, changed_files: 0 };
  const pinned = new Set();
  const warmed = new Map();
  const semantic = createSemanticEngine({ root, options, eventBus });

  async function scan() {
    if (disabled) return getStats();
    const scanned = await scanContextWithCache({ root, options, eventBus });
    records = scanned.records;
    stats = scanned.stats;
    if (semantic.enabled) await semantic.index(records);
    return getStats();
  }

  async function snapshot(input = {}) {
    if (disabled) {
      return {
        snapshot_id: "v2_context_disabled",
        root,
        channel: input.channel || "reply",
        task_type: input.classification?.task_type || "general",
        summary: "",
        units: [],
        budget: { allocated: 0, used: 0, remaining: 0 },
        stats: { ...stats, selected_files: 0 }
      };
    }
    if (records.size === 0) await scan();
    if (semantic.enabled) {
      const semBudget = budgetForChannel(input.channel || "reply", { ...(options.budgets || {}), ...(input.budget ? { [input.channel || "reply"]: input.budget } : {}) });
      const sem = semantic.select({ message: input.message || "", pinned, warmed, budget: semBudget.allocated });
      if (sem) {
        const snap = buildContextSnapshot({
          root,
          channel: semBudget.channel,
          taskType: input.classification?.task_type || "general",
          selected: sem.selected,
          budget: sem.budget,
          stats: { ...stats }
        });
        eventBus?.publish?.("context:snapshot", {
          snapshot_id: snap.snapshot_id,
          channel: snap.channel,
          task_type: snap.task_type,
          unit_count: snap.units.length,
          unit_paths: snap.units.map((unit) => unit.path),
          budget: snap.budget,
          stats: snap.stats
        });
        return snap;
      }
    }
    const channelBudget = budgetForChannel(input.channel || "reply", { ...(options.budgets || {}), ...(input.budget ? { [input.channel || "reply"]: input.budget } : {}) });
    const selected = selectContextUnits({
      units: records,
      message: input.message || "",
      pinned,
      warmed,
      classification: input.classification || {},
      budget: channelBudget.allocated
    });
    const hydrated = await hydrateContextRecords({
      root,
      records: selected.selected,
      options
    });
    const snap = buildContextSnapshot({
      root,
      channel: channelBudget.channel,
      taskType: input.classification?.task_type || "general",
      selected: hydrated.units,
      budget: {
        ...selected.budget,
        used: hydrated.units.reduce((sum, unit) => sum + unit.token_count, 0),
        remaining: Math.max(0, selected.budget.allocated - hydrated.units.reduce((sum, unit) => sum + unit.token_count, 0))
      },
      stats: { ...stats, ...hydrated.stats }
    });
    eventBus?.publish?.("context:snapshot", {
      snapshot_id: snap.snapshot_id,
      channel: snap.channel,
      task_type: snap.task_type,
      unit_count: snap.units.length,
      unit_paths: snap.units.map((unit) => unit.path),
      budget: snap.budget,
      stats: snap.stats
    });
    return snap;
  }

  function pin(inputPath) {
    const relative = normalizeControlPath(inputPath);
    pinned.add(relative);
    eventBus?.publish?.("context:pin", { path: relative });
  }

  function unpin(inputPath) {
    const relative = normalizeControlPath(inputPath);
    pinned.delete(relative);
    eventBus?.publish?.("context:unpin", { path: relative });
  }

  function warm(inputPath, reason = "warm") {
    const relative = normalizeControlPath(inputPath);
    warmed.set(relative, reason);
    eventBus?.publish?.("context:warm", { path: relative, reason });
  }

  function invalidate(inputPath) {
    const relative = normalizeControlPath(inputPath);
    records.delete(relative);
    warmed.delete(relative);
    pinned.delete(relative);
  }

  function getStats() {
    return {
      ...stats,
      pinned_files: pinned.size,
      warmed_files: warmed.size,
      indexed_paths: records.size
    };
  }

  function normalizeControlPath(inputPath) {
    const relative = String(inputPath || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!relative) throw new Error("context path is required");
    if (path.isAbsolute(relative)) throw new Error("context path must be relative");
    if (relative.split("/").includes("..")) throw new Error("context path escapes project root");
    return relative;
  }

  return { scan, snapshot, pin, unpin, warm, invalidate, getStats };
}
