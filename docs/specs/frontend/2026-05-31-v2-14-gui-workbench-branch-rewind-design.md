# V2-14 GUI Workbench Refresh & Branch Rewind UX Design

> Status: proposed
> Date: 2026-05-31
> Scope: rebuild the Electron GUI as a polished three-column agent workbench and expose branch/rewind workflows

## 1. Purpose

V2 now has a strong kernel: tool loop, approval resume, repair loop, context cache, transactional edits, branch-aware rewind, and rewind recovery. The GUI still looks like a thin chat shell. V2-14 turns it into a practical local agent workbench.

The work should combine visual refresh and branch/rewind UX. The current GUI is not visually acceptable for the 1.0 V2 experience, so V2-14 is a UI reconstruction, not a light restyle. The existing three-column direction should be preserved, but it must become a deliberate workbench: clear left navigation/status, focused central conversation, and right operational inspector.

## 2. Goals

1. Replace the old three-layer overlay GUI with a polished three-column workbench layout.
2. Fix garbled visible Chinese/UI text and use clear English UI labels for consistency with existing GUI tests.
3. Keep all user-visible content XSS-safe through `textContent`.
4. Expose branch, checkpoint, rewind preview, and rewind apply through preload and main IPC.
5. Add a branch/timeline panel that lists branches and checkpoints.
6. Add rewind preview/apply UX with explicit confirmation.
7. Display V2-13 recovery results: `failed_restored`, `failed_unrestorable`, and `conflict_restored`.
8. Display usage, speed, and cache hit rate as first-class workbench metrics.
9. Keep GUI usable without a live API key by relying on existing host fallbacks.
10. Add pure renderer model/adapter tests where possible.
11. Allow the executing model to use `frontend-design` skill for visual design review and screenshot QA.
12. Avoid new dependencies unless explicitly justified by the existing GUI stack.

## 3. Non-Goals

- No full visual diff viewer.
- No branch graph visualization beyond a simple list.
- No branch deletion, pruning, or rename.
- No durable crash recovery.
- No Git branch integration.
- No real-time collaborative UI.
- No large frontend framework migration.
- No web browser dev server requirement.

## 4. Current GUI State

Current files:

```text
gui/main.js
gui/preload.js
gui/kernel-host.js
gui/renderer/index.html
gui/renderer/style.css
gui/renderer/app.js
gui/renderer/event-adapter.js
tests/unit/gui/kernel-host.test.js
tests/unit/gui/renderer-event-adapter.test.js
```

Existing strengths:

- `kernel-host.js` already delegates `listBranches`, `listCheckpoints`, `rewindPreview`, and `rewindApply`.
- Renderer uses `textContent`, not `innerHTML`.
- Event adapter has CommonJS tests.
- GUI already receives kernel events through `kernel:event`.

Current gaps:

- `preload.js` and `main.js` do not expose branch/rewind IPC channels.
- `index.html` has garbled button labels and placeholder text.
- `app.js` mixes event buffering, rendering, approval UI, status polling, and overlay logic.
- There is no branch/checkpoint UI.
- There is no rewind preview/apply UI.
- The existing visual style is small and functional, but not yet a product-like workbench.

## 5. Chosen UX Architecture

Use a three-column workbench. The original three-column concept must not be abandoned; V2-14 should refine it into a proper product shell:

```text
+----------------------+---------------------------+----------------------+
| Left Rail            | Conversation              | Inspector            |
| - Project identity   | - Messages                | - Activity           |
| - Active branch      | - Approval card           | - Checkpoints        |
| - Branch list        | - Composer                | - Rewind preview     |
| - Metrics stack      |                           | - Recovery status    |
+----------------------+---------------------------+----------------------+
| Status bar: runtime, channel, tokens, cache, active branch             |
+-----------------------------------------------------------------------+
```

This layout keeps the primary workflow centered on chat while making branch state and rewind actions visible. It should feel like a quiet developer tool, not a marketing page. The visual quality target is closer to a modern IDE/workbench than a chat demo.

## 6. Visual Direction

Use a restrained dark workbench palette with clear information hierarchy:

- Background: near-black neutral, not purple-dominant and not one-note slate.
- Panels: subtle borders and slightly lighter surfaces.
- Accent: one blue/cyan action color, one amber warning color, one red danger color.
- Cards: max 8px radius.
- Typography: system sans-serif, no viewport-scaled font sizes, no negative letter spacing.
- Buttons: compact, predictable, with text labels and small status dots where useful.
- Density: enough information for repeated developer use, without oversized hero-like panels.
- Metrics: use small stat tiles or rows for token usage, latency/speed, and cache hit rate.

Avoid:

- Decorative gradients, bokeh/orbs, large hero treatment.
- Cards inside cards.
- Oversized headings inside compact panels.
- Text that can overflow fixed controls.
- Icons that render as corrupted emoji.

The executing model may use `frontend-design` skill. It should check the UI against these constraints:

- Three columns remain visible on desktop widths.
- The center conversation is visually primary.
- Metrics are visible without opening an overlay.
- No garbled text, emoji fallback boxes, or broken labels.
- Text does not overflow controls at 900px wide.
- The UI does not look like a generic purple gradient dashboard.

## 7. Renderer Module Boundaries

Keep the implementation light, but split pure logic out of `app.js`:

```text
gui/renderer/workbench-state.js
  Pure state reducer/selectors for branches, checkpoints, preview, activity, status.

gui/renderer/event-adapter.js
  Event summaries/icons/status extraction. Extend for branch/rewind/recovery events.

gui/renderer/app.js
  DOM controller only: bind events, call preload API, render state.
```

`workbench-state.js` should be UMD/CommonJS-friendly like `event-adapter.js` so it can be tested in Node.

## 8. Preload and IPC API

Expose these methods through `window.deepseek`:

```js
listBranches()
getActiveBranch()
listCheckpoints(options)
rewindPreview(options)
rewindApply(options)
getTimeline(optionsOrCount)
```

Main IPC channels:

```text
session:branches
session:branch-active
session:checkpoints
session:rewind-preview
session:rewind-apply
```

Existing channels remain unchanged.

All IPC handlers should return data or `{ error }` objects, matching existing style.

## 9. Branch Panel

The sidebar should show:

- Active branch.
- Branch list from `listBranches()`.
- Parent branch if present.
- Fork point label when available.

Minimum branch item:

```text
● br_main
  main

○ br_xxx
  rewind to turn_...
```

Clicking a branch in V2-14 should select it for viewing checkpoints if the underlying API supports `listCheckpoints({ branch_id })`. It does not need to activate the branch for continuation unless a future explicit action is added.

## 10. Checkpoint Timeline

The inspector should show checkpoints from `listCheckpoints({ branch_id })`:

- turn label
- seq/event id short form
- number of cumulative changes
- button: `Preview`

The checkpoint list should be compact and scrollable. Empty state should be a quiet text line: `No checkpoints yet`.

## 11. Rewind Preview and Apply

When a user selects `Preview`:

1. Call `rewindPreview({ target })`.
2. Store preview in state.
3. Show:
   - target label
   - rollback count
   - files
   - planned branch id
   - force checkbox
   - `Apply rewind` button

Apply flow:

1. If no preview exists, do nothing.
2. Call `rewindApply({ target, force })`.
3. Render result status.
4. Refresh branches, checkpoints, and timeline.

Status messages:

- `success`: `Rewind applied. New branch active.`
- `conflict`: `Rewind blocked by dirty files.`
- `conflict_restored`: `Rewind blocked; previous changes were restored.`
- `failed_restored`: `Rewind failed; workspace was restored.`
- `failed_unrestorable`: `Rewind recovery failed. Manual check required.`

## 12. Activity and Status

The activity panel should keep the latest kernel events with safe summaries from `event-adapter.js`.

Status bar should show:

- runtime state
- channel
- total tokens
- cache hit rate
- active branch

The left rail or top of the inspector should additionally show:

- total tokens
- average latency or speed from `avg_latency_ms`
- cache hit rate
- request count

If exact speed cannot be computed, show latency as `avg latency` rather than inventing throughput.

Polling can remain simple every two seconds. It should also refresh branch/checkpoint data after rewind apply.

## 13. Safety and Privacy

Required invariants:

- No renderer path uses `innerHTML`.
- Renderer event summaries must not dump raw payloads.
- Rewind preview displays file paths and counts only, not raw diffs.
- Rewind recovery errors display safe categories only.
- Approval actions still pass real approval IDs.
- IPC does not expose arbitrary kernel methods.
- The UI must not display `reasoning_content`.

## 14. Testing Strategy

Unit tests:

- `event-adapter` summarizes branch, rewind, and recovery events.
- `workbench-state` stores branches, checkpoints, active branch, preview, result, and activity buffer.
- `workbench-state` caps activity length and never mutates previous state.
- `kernel-host` already covers delegates; add main/preload coverage only if existing test setup supports it.
- Metric formatting handles tokens, request count, cache hit rate, and average latency.

Renderer smoke tests:

- Static scan confirms `gui/renderer/app.js` and new renderer modules do not use `innerHTML`.
- Static scan confirms index labels are not garbled.
- Static scan confirms required DOM IDs exist.
- Static scan confirms metric DOM IDs exist for tokens, speed/latency, cache hit rate, and requests.
- Screenshot or manual visual QA is expected when the executing environment can run Electron.

Integration/manual:

- Launch GUI manually if available.
- Verify message send still works.
- Verify branch list/checkpoints load.
- Verify preview/apply calls are reachable.

Regression:

- Full `npm.cmd test`.
- Full `npm.cmd run check`.
- `git diff --check`.
- No `.deepseek-code/v2` pollution from tests.

## 15. Acceptance Criteria

V2-14 is complete when:

1. GUI loads as a three-column workbench.
2. Existing chat send/approval/status behavior remains working.
3. Preload and main IPC expose branch/checkpoint/rewind methods.
4. Branch list renders from kernel data.
5. Checkpoint timeline renders from kernel data.
6. Rewind preview renders rollback count, files, target, and planned branch.
7. Rewind apply calls kernel API and refreshes branch/checkpoint/timeline state.
8. V2-13 recovery statuses are shown clearly.
9. Renderer keeps XSS-safe `textContent` usage.
10. Tests/checks pass.

## 16. Deferred Work

- Visual branch tree graph.
- Diff preview viewer.
- Branch activation UI for browsing old branches.
- Branch deletion/pruning.
- Recovery retry UI.
- Full E2E Electron screenshot testing.

## 17. Final Summary

V2-14 should make the V2 kernel feel usable as a product. The GUI becomes a real agent workbench: conversation in the center, operational context around it, and branch rewind available as a deliberate, preview-first workflow.
