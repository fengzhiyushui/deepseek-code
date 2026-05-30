export function createApprovalCache({ now = Date.now } = {}) {
  const entries = new Map();

  function grant(fingerprint, { decision, ttlMs = 300000 } = {}) {
    if (decision !== "allow") throw new Error("approval cache only stores allow decisions");
    entries.set(fingerprint, { decision, expires_at: now() + ttlMs });
  }

  function get(fingerprint) {
    const entry = entries.get(fingerprint);
    if (!entry) return null;
    if (entry.expires_at <= now()) {
      entries.delete(fingerprint);
      return null;
    }
    return { ...entry };
  }

  function clear() {
    entries.clear();
  }

  return { grant, get, clear };
}
