export function createRecoveryFaults(input = {}) {
  const labels = new Set(input.labels ?? []);
  const hits = new Map();

  return {
    async maybe(label) {
      if (!labels.has(label) || hits.has(label)) {
        return;
      }

      hits.set(label, 1);
      const error = new Error(`recovery fault: ${label}`);
      error.code = "RECOVERY_FAULT";
      error.label = label;
      throw error;
    },

    hitCount(label) {
      return hits.get(label) ?? 0;
    }
  };
}
