import { cluster } from "./experience-cluster.js";
import { score, tierOf } from "./experience-scoring.js";

// Write pipeline: add candidate -> recluster (dedup) -> rescore/retier ->
// drop below-T3 -> enforce cap (evict lowest) -> replace store + log evictions.
// All program logic; deterministic given injected `now` and id tie-breaks.
export async function upsert(store, candidate, { now, cap = 200, thresholds, decayPerDay = 0.02, dedupThreshold = 0.6 } = {}) {
  const before = store.all();
  const beforeIds = new Set(before.map((e) => e.id));
  const clustered = cluster([...before, candidate], { dedupThreshold });
  const clusteredIds = new Set(clustered.map((e) => e.id));

  const scored = clustered.map((e) => {
    const s = score(e, now, { decayPerDay });
    const t = tierOf(s, thresholds);
    return { e: { ...e, tier: t || e.tier }, s, t };
  });

  const belowT3 = scored.filter((x) => x.t === 0);
  let keep = scored.filter((x) => x.t > 0).sort(keepPriority);
  const overCap = keep.slice(cap);
  keep = keep.slice(0, cap);

  const survivors = keep.map((x) => x.e);
  const evictions = [];
  for (const x of belowT3) evictions.push({ id: x.e.id, reason: "below_tier3" });
  for (const x of overCap) evictions.push({ id: x.e.id, reason: "over_cap" });
  for (const id of beforeIds) if (!clusteredIds.has(id)) evictions.push({ id, reason: "merged" });

  await store.replaceAll(survivors);
  if (evictions.length) await store.recordEvictions(evictions);

  return {
    written: survivors.length,
    evicted: belowT3.length + overCap.length,
    merged: [...beforeIds].filter((id) => !clusteredIds.has(id)).length
  };
}

// Higher keep-priority first; ties broken deterministically (spec §5.2):
// score desc -> lastReinforced recent -> created recent -> id asc (smaller id kept).
function keepPriority(a, b) {
  if (b.s !== a.s) return b.s - a.s;
  const lr = ts(b.e.lastReinforced) - ts(a.e.lastReinforced);
  if (lr) return lr;
  const cr = ts(b.e.created) - ts(a.e.created);
  if (cr) return cr;
  return a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0;
}
function ts(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; }
