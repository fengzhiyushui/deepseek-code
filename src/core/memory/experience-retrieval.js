import { normalizeCues, effectiveCues } from "./experience-cluster.js";

const DEFAULT_TIER_WEIGHTS = { 1: 3, 2: 2, 3: 1 };

export function cuesFromText(text) {
  return normalizeCues(String(text || "").split(/[\s,;:.()[\]{}"'`]+/));
}

// Pure, read-only retrieval. Ranks procedural experiences by cue-overlap × tier weight;
// collects matching risk cues separately (they drive permission escalation, not the brief).
export function query(store, { message } = {}, { retrieveK = 5, tierWeights = DEFAULT_TIER_WEIGHTS } = {}) {
  const msgCues = new Set(cuesFromText(message));
  const scored = [];
  const riskCues = new Set();

  for (const e of store.all()) {
    if (effectiveCues(e.cues).length < 2) continue;          // low-signal guard
    const overlap = e.cues.filter((c) => msgCues.has(c)).length;
    if (overlap < 1) continue;
    if (e.kind === "risk") {
      for (const c of e.cues) if (msgCues.has(c)) riskCues.add(c);
      continue;
    }
    scored.push({ e, rel: overlap * (tierWeights[e.tier] || 1) });
  }

  scored.sort((a, b) => (b.rel - a.rel) || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
  const top = scored.slice(0, retrieveK);
  return {
    procedural: top.map(({ e }) => ({ id: e.id, lesson: e.lesson, tier: e.tier, confidence: e.confidence })),
    presentedIds: top.map(({ e }) => e.id),
    riskCues
  };
}
