// gui/src/state/panels.js — decide whether a UI region shows live data or a
// clearly-marked placeholder (§6.3). Placeholders must never look like real state.
const ALWAYS_PLACEHOLDER = new Set(["filetree", "editor", "terminal"]);

export function isLivePanel(region, state) {
  if (ALWAYS_PLACEHOLDER.has(region)) return false;
  if (region === "toolcards") {
    const activity = state && Array.isArray(state.activity) ? state.activity : [];
    return activity.length > 0;
  }
  return true; // chat / timeline / branches / checkpoints / status = live
}
