import { overlaps } from "./path-overlap.js";

// Group topo-ordered subtasks into batches: a batch = the maximal set whose deps
// are already completed AND whose declared file scopes are mutually disjoint.
// No declared scope / scope overlap / unmet deps -> its own (later) batch.
// maxParallelWorkers <= 1 -> every batch is a singleton (== sequential).
export function toBatches(orderedSubtasks, { completedIds = new Set(), maxParallelWorkers = 4 } = {}) {
  const remaining = [...orderedSubtasks];
  const done = new Set(completedIds);
  const batches = [];

  while (remaining.length) {
    const batch = [];
    const batchScopes = [];
    for (const st of remaining) {
      const depsMet = (st.depends_on || []).every((d) => done.has(d));
      if (!depsMet) continue;
      const scope = st.context_scope?.files;
      const hasScope = Array.isArray(scope) && scope.length > 0;
      if (batch.length === 0) {
        batch.push(st);
        if (hasScope && maxParallelWorkers > 1) batchScopes.push(scope); else break; // singleton
      } else {
        if (!hasScope) continue;
        if (batchScopes.some((s) => overlaps(s, scope))) continue;
        if (batch.length >= maxParallelWorkers) break;
        batch.push(st); batchScopes.push(scope);
      }
    }
    if (batch.length === 0) batch.push(remaining[0]); // safety: never stall on unmet deps
    for (const st of batch) { done.add(st.id); remaining.splice(remaining.indexOf(st), 1); }
    batches.push(batch);
  }
  return batches;
}
