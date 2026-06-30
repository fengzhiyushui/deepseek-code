import { clamp01 } from "./experience-schema.js";

const DEFAULT_DECAY_PER_DAY = 0.02;
const MS_PER_DAY = 86400000;

export function daysSince(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return (now() - t) / MS_PER_DAY;
}

// score = confidence + 0.1*ln(1+validations) - decay*ageDays - 0.2*misleads, clamped to [0,1].
export function score(e, now, { decayPerDay = DEFAULT_DECAY_PER_DAY } = {}) {
  const aging = decayPerDay * daysSince(e.lastReinforced, now);
  return clamp01(
    Number(e.confidence || 0)
    + 0.1 * Math.log1p(Number(e.validations || 0))
    - aging
    - 0.2 * Number(e.misleads || 0)
  );
}

// tier 1/2/3 by thresholds; 0 means "below tier 3 → evict".
export function tierOf(s, { T1, T2, T3 }) {
  if (s >= T1) return 1;
  if (s >= T2) return 2;
  if (s >= T3) return 3;
  return 0;
}

export function reinforce(e, now) {
  return { ...e, validations: (e.validations || 0) + 1, lastReinforced: new Date(now()).toISOString() };
}

export function weaken(e) {
  return { ...e, misleads: (e.misleads || 0) + 1 };
}
