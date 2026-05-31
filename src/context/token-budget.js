const DEFAULT_BUDGETS = Object.freeze({
  think: 12000,
  act: 8000,
  repair: 10000,
  reply: 6000,
  default: 6000
});

export function budgetForChannel(channel = "reply", overrides = {}) {
  const key = String(channel || "reply");
  const value = overrides[key] ?? DEFAULT_BUDGETS[key] ?? overrides.default ?? DEFAULT_BUDGETS.default;
  if (!Number.isFinite(value) || value < 0) throw new Error("budget must be a non-negative number");
  return { channel: key, allocated: value };
}

export function selectWithinBudget(units = [], allocated = 0) {
  if (!Number.isFinite(allocated) || allocated < 0) throw new Error("budget must be a non-negative number");
  const selected = [];
  const skipped = [];
  let used = 0;

  for (const unit of units) {
    const cost = Number(unit.token_count || 0);
    if (used + cost <= allocated) {
      selected.push(unit);
      used += cost;
    } else {
      skipped.push(unit);
    }
  }

  return {
    selected,
    skipped,
    budget: {
      allocated,
      used,
      remaining: allocated - used
    }
  };
}
