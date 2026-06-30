// Heuristic text-similarity clustering for experience lessons (no embedding dep).
// Token-set Jaccard over normalized cues, bucketed by kind so risk/procedural never merge.

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "be", "to", "of", "and", "or", "for", "in", "on",
  "with", "this", "that", "it", "as", "at", "by",
  "的", "了", "和", "与", "在", "是", "这", "那"
]);
// Low-information words that are too generic to drive matching.
const LOWINFO = new Set([
  "test", "tests", "file", "files", "error", "errors", "code", "fix", "fixes",
  "update", "updates", "change", "changes", "add", "remove", "thing", "things", "stuff"
]);

function isCodeToken(s) {
  return /[/\\]/.test(s) || /\.[a-z0-9]+$/i.test(s) || /\s/.test(s);
}

function cleanToken(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[^\w*./\\\s-]+|[^\w*./\\\s-]+$/g, "");
}

function informative(s) {
  return isCodeToken(s) || (!STOPWORDS.has(s) && !LOWINFO.has(s));
}

export function normalizeCues(raw) {
  const out = new Set();
  for (const r of raw || []) {
    const s = cleanToken(r);
    if (!s) continue;
    if (!informative(s)) continue;
    out.add(s);
  }
  return [...out].sort();
}

// Subset of (already-normalized) cues that carry signal — used for the >=2 guard.
export function effectiveCues(cues) {
  return (cues || []).filter(informative);
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function seed(e, eff) {
  return { best: e, validations: e.validations || 0, cues: new Set(e.cues), members: [e.id], prov: e.provenance ? [e.provenance] : [], eff };
}

function mergeInto(c, e) {
  c.validations += e.validations || 0;
  for (const x of e.cues) c.cues.add(x);
  c.members.push(e.id);
  if (e.provenance) c.prov.push(e.provenance);
  // keep highest tier (smallest tier number); tie -> smaller id
  if (e.tier < c.best.tier || (e.tier === c.best.tier && e.id < c.best.id)) c.best = e;
  c.eff = effectiveCues([...c.cues]);
}

function finalize(c) {
  const out = { ...c.best, validations: c.validations, cues: [...c.cues].sort() };
  const mergedFrom = c.members.filter((id) => id !== c.best.id);
  if (c.best.provenance) out.provenance = { ...c.best.provenance, ...(mergedFrom.length ? { mergedFrom } : {}) };
  return out;
}

// Group near-duplicate entries: bucket by kind, greedy id-ordered merge by jaccard>=threshold.
// Entries with <2 effective cues are never merged (left as singletons).
export function cluster(entries, { dedupThreshold = 0.6 } = {}) {
  const byKind = new Map();
  for (const e of entries) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, []);
    byKind.get(e.kind).push(e);
  }
  const out = [];
  for (const kind of [...byKind.keys()].sort()) {
    const bucket = byKind.get(kind).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const clusters = [];
    for (const e of bucket) {
      const eff = effectiveCues(e.cues);
      let placed = false;
      if (eff.length >= 2) {
        for (const c of clusters) {
          if (c.eff.length >= 2 && jaccard(eff, c.eff) >= dedupThreshold) {
            mergeInto(c, e);
            placed = true;
            break;
          }
        }
      }
      if (!placed) clusters.push(seed(e, eff));
    }
    for (const c of clusters) out.push(finalize(c));
  }
  return out;
}
