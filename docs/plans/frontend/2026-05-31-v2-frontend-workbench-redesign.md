# V2 Frontend Workbench Redesign Plan

## Task 1: Strengthen Design Tests

- Add static tests requiring design tokens in `style.css`.
- Add static tests for semantic workbench regions and compact status elements.
- Add static/state tests for restrained traffic-light status indicators.
- Add tests that forbid `innerHTML`, decorative gradients, and missing focus-visible styles.
- Add state tests for empty-state visibility, inspector mode, and status summaries.

## Task 2: Tokenize CSS

- Add `:root` CSS variables for surfaces, text, borders, semantic colors, focus, spacing, radius, and pane widths.
- Replace scattered raw colors in `style.css` with tokens.
- Add consistent `:focus-visible`, hover, active, disabled, selected, loading, and danger states.

## Task 3: Rebuild Markup Structure

- Keep the three desktop panes.
- Add sidebar session/status block.
- Add center empty-state/current-turn panel above messages when conversation is empty.
- Add inspector groups for activity, checkpoints, and rewind with stronger headings and metadata.
- Add accessible labels for composer, refresh, rewind, and force controls.

## Task 4: Upgrade Renderer Behavior

- Render useful empty state when there are no messages.
- Render activity rows with compact type/status metadata.
- Render branch and checkpoint rows with active/selected/current markers.
- Render degraded/offline state in both error strip and status surfaces.
- Keep all dynamic content on `textContent`.

## Task 5: Responsive Behavior

- Add <=1020px layout: inspector hidden with explicit status affordance or relocated summary.
- Add <=720px layout: sidebar becomes top context area and conversation remains usable.
- Ensure composer and primary controls retain stable height.

## Task 6: Visual QA Harness

- Generate temporary mock screenshots for 1440x900, 1020x760, and 720x760.
- Inspect screenshots manually.
- Remove temporary QA files after inspection.

## Task 7: Full Regression

- Run focused GUI tests.
- Run `npm.cmd test`.
- Run `npm.cmd run check`.
- Run `git diff --check`.
- Confirm `.deepseek-code/v2` and temporary QA dirs are absent.
