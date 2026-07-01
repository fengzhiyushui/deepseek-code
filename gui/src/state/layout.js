// gui/src/state/layout.js — responsive breakpoints for the four-column shell.
// Pure: drives which panels are visible at a given viewport width (§6.1).
export function layoutForWidth(px) {
  const w = Number(px) || 0;
  return {
    rail: w >= 760, // below this the rail becomes bottom tabs
    sidebar: w >= 1340,
    chat: w >= 1060
  };
}
