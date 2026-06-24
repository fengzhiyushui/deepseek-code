# V2 Frontend Workbench Redesign Design

## Objective

Refresh the Electron GUI from a basic three-column shell into a mature local-agent workbench. The design must preserve the existing three-pane mental model while improving visual quality, information density, runtime status, branch/rewind usability, and screenshot-verifiable responsiveness.

## Research Basis

The design is grounded in:

- NN/g usability heuristics: visible system status, user control/recovery, consistency, error prevention, recognition over recall, minimalist operational interfaces.
- WCAG 2.2 and WAI-ARIA APG: visible focus, keyboard operability, adequate contrast, non-color-only meaning, accessible labels.
- Carbon, Fluent, Polaris, Atlassian, Material, and web.dev guidance: tokenized spacing/color, predictable interaction states, stable layout, responsive content priority, reduced layout shift.
- Local skills: `ui-ux-pro-max` and `frontend-workbench-design`.

## Product Frame

This UI is not a landing page. It is an IDE-like control surface for a local coding agent:

- Left pane: session/branch context, status, usage, quick navigation.
- Center pane: conversation and current turn, with useful empty state and persistent composer.
- Right pane: activity, approvals, checkpoints, rewind preview and recovery.
- Bottom status: autonomy, channel, runtime, active branch, degraded/offline hints.

The workbench should feel quiet, precise, and tool-like. Avoid decorative gradients, blobs, large hero type, and nested card stacks.

## Visual System

Use a dark developer-tool palette with neutral layers:

- Base: near-black ink.
- Surfaces: 3-4 slate layers for panes, rows, controls, and elevated alerts.
- Borders: subtle default, stronger selected/focus.
- Accent: green for running/success/cache, blue for primary neutral action, amber for approval/warning, red for danger/error.
- Typography: system sans for UI, system mono only for IDs, branch names, numeric metrics, and code-like values.
- Radius: 4-8px.
- Spacing: 4px base scale with 8/12/16/20/24px steps.

CSS should define tokens in `:root` and reuse them instead of scattering raw colors.

## Layout

Preserve three panes on desktop:

- Sidebar: 260px. Contains brand/session strip, branch list, usage/status block.
- Conversation: flexible center. Contains topbar, empty/current-turn area, messages, approval box, composer.
- Inspector: 340px. Contains tabs or grouped panels for activity, approvals, checkpoints, and rewind.
- Status bar: fixed bottom row with compact runtime facts.

Responsive:

- At <= 1020px, keep sidebar + conversation and hide inspector behind an explicit inspector toggle or convert inspector content into a lower drawer.
- At <= 720px, collapse sidebar into a top context strip and keep the conversation/composer usable.

## Functional UX Changes

1. Empty state: Center pane should explain current workspace state with compact starter actions/status, not a blank canvas.
2. Usage/status: Show tokens, cache hit, latency, requests, runtime, channel, branch, and degraded state without requiring the status bar only.
3. Branch/checkpoint rows: Add active/selected/current markers, metadata, and stable hover/focus states.
4. Activity timeline: Make event rows easier to scan with type, summary, branch, and time/sequence metadata.
5. Approval/rewind: Risky controls should live in the inspector with clear preview/result state and distinct danger styling.
6. Error/degraded state: Top error strip remains, but it should look integrated and not dominate normal work.
7. Accessibility: Add labels, focus-visible styles, role-appropriate controls, and avoid color-only status.
8. Traffic-light status: Add a restrained traffic-light mechanism for global agent health and key lifecycle states only. Use green for ready/complete, yellow for working/awaiting approval/warning, red for error/conflict, and neutral gray for offline/unknown. Do not add per-event rainbow indicators.

## Implementation Boundaries

Do not rewrite the V2 runtime, IPC contract, or kernel host. Work in the renderer layer unless a small preload/host delegate is required for UI data already exposed by V2.

Primary files:

- `gui/renderer/index.html`
- `gui/renderer/style.css`
- `gui/renderer/app.js`
- `gui/renderer/workbench-state.js`
- `tests/unit/gui/*`

## Verification

Automated:

- Unit/static tests for required DOM IDs/classes/tokens.
- State model tests for selected/loading/error/empty/status fields.
- `npm.cmd test`
- `npm.cmd run check`
- `git diff --check`

Visual:

- Headless screenshot at 1440x900 desktop with mock data.
- Headless screenshot at 1020x760 breakpoint.
- Headless screenshot at 720x760 compact layout.
- Manual inspection for blank areas, overlap, clipped controls, unreadable text, broken inspector access, and excessive decoration.

## Risks

- The existing renderer is plain HTML/CSS/JS. Keep the redesign disciplined; do not introduce a framework just for styling.
- Electron visual QA may require local Chrome/Electron availability.
- Some richer UI behavior, such as drawers or tabs, must be implemented without creating unsafe `innerHTML`.
