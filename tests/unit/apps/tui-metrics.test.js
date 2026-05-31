import test from "node:test";
import assert from "node:assert/strict";
import { renderTuiStatusLine } from "../../../src/tui.js";

test("renderTuiStatusLine includes usage cache metrics when available", () => {
  const line = renderTuiStatusLine({
    runtime: { getState: () => ({ current: "idle", channel: "act" }) },
    config: { getPublicConfig: () => ({ runtime: "v2" }) },
    metrics: {
      getUsage: () => ({
        total_tokens: 1234,
        cache_hit_rate: 0.4567,
        cache_hit_tokens: 400,
        cache_miss_tokens: 476
      })
    }
  });

  assert.ok(line.includes("idle"));
  assert.ok(line.includes("act"));
  assert.ok(line.includes("tokens:1234"));
  assert.ok(line.includes("cache:45.7%"));
});

test("renderTuiStatusLine falls back to zero usage", () => {
  const line = renderTuiStatusLine({
    runtime: { getState: () => ({ current: "idle", channel: null }) },
    config: { getPublicConfig: () => ({ runtime: "v2" }) }
  });

  assert.ok(line.includes("tokens:0"));
  assert.ok(line.includes("cache:0.0%"));
});
