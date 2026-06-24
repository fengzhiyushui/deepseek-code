# V2-16 GUI Interaction Hardening & Release Polish Design

## Objective

Make the V2-15 Natural Agent Workbench feel reliable in real use, not only in static screenshots. This phase hardens interaction behavior, preference persistence, keyboard accessibility, drawer/inspector lifecycle, and Electron smoke coverage while preserving the V2-15 layout and visual direction.

V2-16 is not a new visual redesign. It is the release-polish layer that makes the existing workbench predictable under real GUI use.

## Current State

V2-15 delivered:

- command bar, activity rail, context panel, agent session, contextual inspector, and statusline,
- Night Workbench and Day Review themes,
- single traffic-light status cluster,
- branch/checkpoint/rewind surfaces,
- renderer static/state tests,
- headless mock screenshot QA.

Remaining gaps:

- theme and panel preferences are session-local only,
- mobile/medium drawer behavior is implicit and has no durable UI contract,
- inspector opens for risk events but lacks a clear close path and focus management,
- rail labels are accessible but icon letters are still abstract,
- real Electron smoke is not covered in tests,
- renderer controller is growing large and needs clearer helper boundaries before more GUI features are added.

## Scope

### In Scope

- Persist renderer preferences:
  - theme,
  - context panel collapsed state,
  - last rail mode.
- Add small IPC bridge for GUI preferences backed by a local JSON file under `.deepseek-code/gui-preferences.json`.
- Add explicit inspector/drawer close control.
- Add keyboard shortcuts:
  - `Ctrl+1` Chat,
  - `Ctrl+2` Context,
  - `Ctrl+3` Branches,
  - `Ctrl+4` Timeline,
  - `Ctrl+5` Settings,
  - `Ctrl+K` focus composer,
  - `Escape` close inspector drawer or clear active approval panel focus.
- Improve live interaction states:
  - approval opens inspector and can close after resolution,
  - rewind preview opens inspector,
  - error opens details,
  - manual inspector close returns to activity mode.
- Add an Electron smoke test that launches the GUI with an injected temp project and validates the rendered shell without requiring network access.
- Keep unsafe rendering protections: no `innerHTML` assignment for dynamic content.

### Out of Scope

- New runtime features.
- New agent behaviors.
- New branch/rewind backend semantics.
- Heavy GUI framework migration.
- Durable approval/repair resume.
- Full visual redesign beyond small interaction affordances.

## Preference Storage

Add a small preference layer in the GUI host/main side:

- File path: `<projectRoot>/.deepseek-code/gui-preferences.json`.
- Schema:

```json
{
  "schema": 1,
  "theme": "night",
  "contextCollapsed": false,
  "railMode": "chat"
}
```

Rules:

- Missing/corrupt file returns defaults.
- Unknown theme/rail values are ignored.
- Writes are best-effort and atomic enough for local desktop use.
- Preferences must not include transcript content, prompts, tool output, file paths from context snippets, or secrets.

Expose through IPC:

- `gui:preferences-get`
- `gui:preferences-set`

Renderer behavior:

- Load preferences before first render when possible.
- If loading fails, continue with defaults and report a non-blocking degraded error.
- Write preferences when theme, rail mode, or panel collapsed state changes.

## Inspector & Drawer Lifecycle

The right inspector should feel intentional:

- Risk events auto-open it:
  - approval,
  - rewind preview,
  - error/conflict/recovery failure.
- User can close it with a visible close button or `Escape`.
- Closing sets `inspectorMode: "activity"` and removes drawer overlay on medium/compact widths.
- Selecting a checkpoint reopens rewind mode.
- Resolving approval closes approval mode unless another risk result is active.

The context panel:

- Opens when a rail mode is selected.
- Collapses via the context toggle.
- On narrow widths, defaults to collapsed on first load unless persisted preference says otherwise.
- `Escape` closes the context drawer only if no inspector drawer is open.

## Keyboard Accessibility

Keyboard controls must not fight normal text input:

- Global shortcuts are ignored when the active element is an input, textarea, or contenteditable element, except `Escape`.
- `Ctrl+K` focuses `#msg-input`.
- `Escape` closes inspector/context drawers before doing anything else.
- Rail shortcut actions update the same state path as clicking rail buttons.

Focus requirements:

- Visible focus remains in CSS.
- When inspector opens because of approval or rewind, focus moves to the inspector close button or first relevant action.
- When inspector closes, focus returns to the composer if possible.

## Electron Smoke

Add a lightweight smoke test that:

- starts Electron from `gui`,
- passes a temp project path via `--project=<temp>`,
- waits until `#command-bar`, `#activity-rail`, `#agent-session`, and `#statusline` exist,
- confirms no blank window,
- confirms theme toggle exists,
- exits cleanly.

The smoke test should avoid real model calls and network access. It only validates shell boot and bridge readiness. If direct Electron automation is too brittle on CI, make the test skip with a clear reason when Electron is unavailable, but run locally when `gui/node_modules/electron` exists.

## File Boundaries

Primary files:

- `gui/kernel-host.js`: preference load/save helpers or delegates.
- `gui/main.js`: preference IPC handlers.
- `gui/preload.js`: expose preference bridge.
- `gui/renderer/workbench-state.js`: state actions/selectors.
- `gui/renderer/app.js`: preference loading, keyboard shortcuts, drawer close/focus behavior.
- `gui/renderer/index.html`: close button and stable IDs.
- `gui/renderer/style.css`: close button and drawer interaction states.

Tests:

- `tests/unit/gui/kernel-host.test.js`
- `tests/unit/gui/renderer-static.test.js`
- `tests/unit/gui/workbench-state.test.js`
- `tests/unit/gui/renderer-interactions.test.js` or static/state equivalent
- `tests/e2e/gui-smoke.test.js`

## Verification

Automated:

- Focused GUI tests.
- Electron smoke test when Electron is available.
- `npm.cmd test`
- `npm.cmd run check`
- `git diff --check`

Visual:

- Re-run mock screenshots at desktop and compact widths after adding controls.
- Confirm no overlap, no hidden composer, close button visible, traffic label visible.

Pollution checks:

- Tests must use temp project roots.
- No test should create `.deepseek-code/v2` in the repository root.
- Real user-started GUI may create `.deepseek-code/v2`; that is not test pollution.

## Risks

- Electron smoke can be flaky on headless systems. Keep it defensive and skippable only when Electron is truly unavailable.
- Preference writes could create local files in the user project. This is intentional for real GUI use but tests must isolate it.
- Focus management in plain JavaScript can become tangled; keep it small and state-driven.
