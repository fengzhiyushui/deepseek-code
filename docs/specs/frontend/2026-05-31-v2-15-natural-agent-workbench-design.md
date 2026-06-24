# V2-15 Natural Agent Workbench Design

## Objective

Redesign the Electron GUI into a natural local-agent workbench rather than a dressed-up three-column dashboard. The UI should feel closer to modern AI coding tools: Codex/Claude Code for readable agent execution, Cursor/Trae for IDE-like side context, and Kiro for structured engineering artifacts such as specs, checkpoints, branches, and recovery.

The existing three-region mental model remains, but it becomes a more natural workbench contract:

- a narrow activity rail for mode switching,
- a collapsible context panel for branch/context/usage,
- a primary agent session in the center,
- a contextual inspector on the right,
- a bottom statusline for runtime facts.

## Research Basis

This design uses current UI research and official design-system guidance:

- Carbon Design System color guidance (https://carbondesignsystem.com/elements/color/overview/): tokens make color reusable at scale, dark themes should use layer-aware surfaces, and dark layers become lighter as they rise.
- Atlassian color foundations (https://atlassian.design/foundations/color/): token names should reflect UI intent, and light/dark values should be theme-compliant behind the same semantic token.
- VS Code theme color reference (https://code.visualstudio.com/api/references/theme-color): IDE workbenches need layer-specific colors for activity bars, side bars, editors, panels, lists, focus, selection, badges, input, and diff states.
- Material color role guidance (https://m3.material.io/styles/color/roles): separate accent roles, surface roles, outline roles, and error roles instead of binding components to raw colors.
- WCAG contrast guidance (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): normal text contrast should meet 4.5:1, large text and graphical indicators should meet 3:1, and state must not rely on color alone.
- Local skills: `frontend-workbench-design`, `ui-ux-pro-max`, and the new `color-system-design` skill.

## Product Frame

This is an agentic IDE surface. The first screen should be usable immediately, not a landing page. Users should always know:

- what the agent is doing,
- whether it needs approval,
- which branch/checkpoint they are on,
- what context/cache/usage looks like,
- what changed and whether it can be rewound,
- whether the kernel is healthy, degraded, or offline.

The UI should feel calm, technical, and durable. Avoid decorative hero sections, marketing composition, animated blobs, heavy gradients, and card piles.

## Layout Contract

### Top Command Bar

The top row is a compact command/status bar:

- left: product/session identity and current workspace label,
- center: current task or selected checkpoint summary,
- right: model/autonomy, one traffic-light status cluster, and quick refresh.

This replaces the old large per-pane headers as the primary orientation surface.

### Activity Rail

A narrow rail sits on the far left, similar to IDE activity bars:

- Chat,
- Context,
- Branches,
- Timeline,
- Settings.

It is icon-first but every button must have an accessible label. The rail should not become another metrics column.

### Collapsible Context Panel

The panel next to the rail shows the active rail mode:

- Chat mode: active branch, compact metrics, approval summary.
- Context mode: indexed context/cache health.
- Branches mode: branch list and active marker.
- Timeline mode: recent events.
- Settings mode: theme and runtime preferences.

Desktop default width: 280px. It can collapse to rail-only. At narrow widths it becomes a drawer.

### Primary Agent Session

The center is the main work surface:

- compact empty state,
- message transcript,
- grouped tool events per turn,
- approval prompt when needed,
- verification/repair summaries,
- persistent composer.

The transcript should read like an execution log plus conversation, not like a generic chat app. Tool output, diffs, verification, and repair should be visually grouped and scannable.

### Contextual Inspector

The right inspector changes with selection:

- selected event: event details,
- selected checkpoint: preview and rewind actions,
- approval needed: approval details and risk,
- branch selected: branch ancestry/checkpoints,
- no selection: recent activity and health.

Approval and rewind actions should autofocus this inspector because they are risk-bearing.

### Bottom Statusline

The bottom line is Claude Code / IDE-like:

- runtime,
- active branch,
- autonomy,
- approval state,
- tokens,
- cache hit,
- average latency,
- request count,
- dirty/clean or degraded/offline.

This statusline is for persistent facts, not verbose help text.

## Two-Theme Color System

The GUI must support two complete themes via semantic tokens:

1. **Night Workbench**: default dark theme for long coding sessions.
2. **Day Review**: light theme for screenshots, daylight use, and review.

Both themes use identical token names. Components only reference tokens; raw hex values belong in theme declarations.

Required token groups:

- backgrounds: app, rail, panel, main, elevated, inset,
- text: primary, secondary, muted, inverse,
- borders: subtle, strong, focus, selection,
- accent: primary, hover, soft,
- semantic: success, warning, danger, info, offline,
- agent: traffic-ready, traffic-working, traffic-error, traffic-offline,
- code/diff: code background, diff add/remove backgrounds and borders.

The default palette direction:

- Night Workbench: ink/slate surfaces, blue/cyan accent, restrained green/yellow/red status.
- Day Review: cool off-white base, white panels, slate text, same accent family, darker status colors for contrast.

## Traffic-Light Mechanism

Use one primary traffic-light status cluster, placed in the top command bar and echoed textually in the statusline. Do not add many scattered lights.

State mapping:

- Green: ready, complete, clean, connected.
- Yellow: working, awaiting approval, verifying, degraded.
- Red: error, denied, rollback conflict, unsafe.
- Gray: idle without active session, offline, unavailable.

The light always has adjacent text such as `Ready`, `Working`, `Approval`, `Error`, or `Offline`. Color is never the only cue.

## Interaction Model

- Rail button click changes the context panel mode.
- Context panel can collapse and persist in memory for the session.
- Selecting a branch loads branch checkpoints.
- Selecting a checkpoint opens the inspector rewind preview.
- Approval events switch inspector mode to approval.
- Error/conflict events switch inspector mode to details.
- Theme toggle changes `data-theme` on the root and updates persisted renderer preference if the bridge supports it; otherwise it remains session-local.
- All dynamic model/user content uses `textContent`, not `innerHTML`.

## Responsive Behavior

- Desktop >= 1200px: rail + context panel + agent session + inspector.
- Medium 900-1199px: inspector becomes a slide-over/drawer, context panel remains.
- Compact <= 760px: rail becomes top segmented navigation, context and inspector are drawers, center transcript/composer stay primary.

No breakpoint may hide the composer, traffic-light label, or current runtime/branch facts.

## Accessibility

- Keyboard focus must be visible on every rail item, tab, branch, checkpoint, approval, rewind, theme, and composer control.
- Icon-only controls require `aria-label`.
- Status lights require adjacent visible text.
- Theme contrast must be checked for both themes.
- Risk actions use labels and confirmation/preview, not color alone.

## Implementation Boundaries

Do not change V2 runtime behavior, approval semantics, rewind semantics, context cache, or session storage. Work primarily in:

- `gui/renderer/index.html`
- `gui/renderer/style.css`
- `gui/renderer/app.js`
- `gui/renderer/workbench-state.js`
- `tests/unit/gui/*`

Only touch preload/host if the renderer needs a small already-supported delegate or preference hook.

## Verification

Automated:

- Static tests for required layout regions, rail, command bar, statusline, theme tokens, and traffic-light label.
- State tests for rail mode, panel collapse, inspector context, theme switching, and traffic tone.
- Tests forbidding unsafe `innerHTML` rendering.
- `npm.cmd test`
- `npm.cmd run check`
- `git diff --check`

Visual:

- Screenshot 1440x900 Night Workbench with mock transcript, metrics, branches, and rewind.
- Screenshot 1440x900 Day Review with same data.
- Screenshot 1020x760 medium layout.
- Screenshot 720x760 compact layout.
- Inspect for blank regions, overlap, hidden composer, unreadable text, noisy color, and broken status visibility.

## Known Risks

- The current renderer is plain HTML/CSS/JS; keep the refactor modular without introducing a framework.
- Visual QA depends on local Chrome/Electron availability.
- The old V2-14/V2-frontend redesign files may contain partial three-column assumptions; implementation must replace them with this layout contract rather than merely polishing them.
- Theme preference persistence may need a later small IPC addition if local renderer-only preference is not enough.
