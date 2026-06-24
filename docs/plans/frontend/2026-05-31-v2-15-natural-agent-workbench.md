# V2-15 Natural Agent Workbench Implementation Plan

## Task 1: Replace GUI Static Contract Tests

- Update `tests/unit/gui/renderer-static.test.js` to require:
  - `#command-bar`
  - `#activity-rail`
  - `#context-panel`
  - `#agent-session`
  - `#contextual-inspector`
  - `#statusline`
  - `#traffic-light` and `#traffic-light-label`
  - theme toggle/control
- Require `data-theme` support and both Night/Day theme token blocks in `style.css`.
- Require focus-visible styling.
- Keep the no-`innerHTML` assignment guard.
- Run focused GUI static tests and confirm they fail before implementation.

## Task 2: Extend Workbench State Model

- Update `gui/renderer/workbench-state.js`:
  - add `railMode`
  - add `contextCollapsed`
  - add `inspectorMode`
  - add `theme`
  - keep metrics, branch, checkpoint, rewind, approval, activity, and error state.
- Add actions:
  - `rail_mode_changed`
  - `context_collapsed_changed`
  - `inspector_mode_changed`
  - `theme_changed`
  - keep existing branch/checkpoint/rewind actions.
- Add selectors/helpers:
  - `trafficTone(state)`
  - `trafficLabel(state)`
  - `statusSummary(state)`
  - `themeLabel(state)`
- Update `tests/unit/gui/workbench-state.test.js` first and verify failing/passing cycle.

## Task 3: Rebuild HTML Layout

- Replace the previous three-pane markup in `gui/renderer/index.html` with:
  - root `#app.workbench-shell[data-theme="night"]`
  - compact `#command-bar`
  - `#activity-rail`
  - collapsible `#context-panel`
  - central `#agent-session`
  - `#contextual-inspector`
  - `#statusline`
- Keep existing important IDs where app logic depends on them:
  - `#messages`
  - `#approval-box`
  - `#composer`
  - `#msg-input`
  - `#branch-list`
  - `#checkpoint-list`
  - `#activity-log`
  - `#rewind-preview`
  - `#rewind-force`
  - `#rewind-apply`
- Add accessible labels for icon/rail controls.

## Task 4: Rebuild CSS Theme and Layout

- Define semantic tokens for Night Workbench in `:root, [data-theme="night"]`.
- Define Day Review overrides in `[data-theme="day"]`.
- Replace old pane/card CSS with:
  - app grid: command bar, body, statusline,
  - body grid: rail, context panel, center, inspector,
  - responsive breakpoints at 1200, 900, and 760px.
- Add one restrained traffic-light component.
- Add focus-visible, hover, selected, danger, disabled, loading, and reduced-motion states.
- Avoid gradients and decorative effects.

## Task 5: Rewire Renderer Controller

- Update `gui/renderer/app.js` to bind:
  - rail buttons,
  - context collapse toggle,
  - theme toggle,
  - inspector mode buttons if present.
- Update render functions to:
  - apply `data-theme`,
  - render context panel mode,
  - render contextual inspector mode,
  - update command-bar status and statusline metrics,
  - switch inspector to approval/rewind/error when relevant.
- Preserve safe rendering via `textContent`.

## Task 6: Focused Verification

- Run:
  - `npm.cmd test -- tests/unit/gui/renderer-static.test.js tests/unit/gui/workbench-state.test.js tests/unit/gui/renderer-event-adapter.test.js`
- Fix failures without widening scope.

## Task 7: Visual QA Harness

- Create temporary `.tmp-gui-qa/mock-workbench.html` that loads real renderer CSS/JS with mock `window.deepseek`.
- Capture screenshots:
  - 1440x900 night,
  - 1440x900 day,
  - 1020x760,
  - 720x760.
- Inspect screenshots for:
  - nonblank rendering,
  - visible composer,
  - visible traffic-light label,
  - readable metrics,
  - no overlap/clipping,
  - coherent panel/drawer behavior.
- Delete `.tmp-gui-qa`.

## Task 8: Full Regression

- Run:
  - `npm.cmd test`
  - `npm.cmd run check`
  - `git diff --check`
  - `Test-Path .deepseek-code\v2`
  - `Test-Path .tmp-gui-qa`
- Summarize changes, verification, screenshots inspected, and any remaining UI risks.
