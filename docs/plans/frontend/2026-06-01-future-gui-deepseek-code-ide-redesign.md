# Future GUI DeepSeek Code IDE Redesign Plan

> 完成状态以 [CHANGELOG](../../CHANGELOG.md) 为准。

> Status: Deferred future plan  
> Date: 2026-06-01  
> Trigger: Revisit after the V2 iteration/recovery milestones are complete enough to avoid mixing product UI redesign with runtime hardening.

## Purpose

The project has a future frontend redesign target based on the user-provided mockup and local React single-file component:

- Source reference: `DeepSeekCodeIDE.jsx`
- Visual reference: DeepSeek Code IDE screenshot provided in conversation

The goal is to eventually rebuild the current Electron GUI so it visually and structurally matches that DeepSeek Code IDE experience: project explorer, file tree, editor surface, terminal, task list, right-side AI Agent panel, plan/progress cards, editing files, tests, patch preview, and task status.

This is intentionally deferred. It should not be mixed into V2-18 Durable Recovery because V2-18 is runtime reliability work, while this is product/UI redesign work.

## Recommended Timing

Do this after the current V2 iteration stabilizes, preferably after the durable recovery work is split and completed far enough that GUI work will not be blocked by kernel/runtime churn.

Recommended sequence:

1. Finish or pause V2-18a recovery infrastructure cleanly.
2. Complete enough V2 runtime/recovery behavior that GUI state can rely on stable kernel APIs.
3. Start a separate GUI redesign spec and implementation plan.
4. Use a separate worktree/branch, for example:

```text
gui-deepseek-code-ide-redesign
```

## Why This Must Be Separate

Do not implement this inside the V2-18 recovery worktree.

Reasons:

- V2-18 touches `src/core/recovery/*`, runtime approval/resume, edit/rewind journals, and kernel recovery APIs.
- GUI redesign touches `gui/renderer/*`, `gui/kernel-host.js`, layout/state/rendering, and possibly frontend build strategy.
- Mixing them creates a large, hard-to-review branch.
- A UI regression should not force rollback of recovery infrastructure.
- A recovery bug should not block visual polish or layout work.

## Initial Technical Recommendation

Prefer to keep the existing Electron/vanilla renderer architecture at first and reproduce the `DeepSeekCodeIDE.jsx` design in the current GUI stack.

Current likely GUI stack:

- Electron main/preload
- `gui/kernel-host.js`
- `gui/renderer/app.js`
- `gui/renderer/workbench-state.js`
- `gui/renderer/event-adapter.js`
- static CSS/DOM rendering

Recommended first approach:

```text
Do not introduce React immediately.
Recreate the JSX mockup's visual structure using the existing Electron renderer.
```

Reason:

- avoids adding a bundler/build pipeline;
- avoids React dependency and package-lock churn;
- keeps GUI smoke tests simpler;
- lets the project validate the layout and UX first;
- lower risk while V2 kernel APIs are still evolving.

A later milestone can decide whether to migrate the renderer to React if the vanilla implementation becomes hard to maintain.

## Target Visual/UX Elements

The future redesign should reproduce the important elements from `DeepSeekCodeIDE.jsx` and the screenshot:

1. Top bar
   - DeepSeek Code brand
   - repo/project selector
   - branch selector
   - search box
   - connection/model status
   - settings/close controls

2. Left activity rail
   - project/files
   - search
   - source control/branches
   - run/tasks
   - extensions/tools
   - agent/bot
   - metrics
   - settings

3. Left project sidebar
   - project name
   - repository list
   - file tree
   - tasks list
   - agent shortcuts

4. Central workbench
   - editor tabs
   - code editor surface
   - line numbers
   - minimap-like preview
   - terminal panel
   - problems/output/debug tabs

5. Right AI Agent panel
   - model badge
   - connection state
   - user request bubble
   - agent plan checklist
   - searching codebase card
   - editing files card
   - run tests card
   - patch preview card
   - task status card
   - prompt composer

6. Visual style
   - clean white workspace
   - blue accent color
   - card-based right panel
   - subtle borders and shadows
   - VS Code-like layout density
   - polished SaaS/IDE hybrid look

## Future Design Questions

When this milestone starts, answer these before implementation:

1. Should the redesign remain vanilla Electron or introduce React?
2. Should `DeepSeekCodeIDE.jsx` be treated as a static visual reference or as actual source to port?
3. Which current GUI features must remain fully functional in the first redesign pass?
4. Should the editor area be a static code-like preview, a real file viewer, or integrated with a real editor component?
5. How much of the right AI Agent panel should be live data vs. initially mocked from kernel events?
6. Should the GUI include Recovery Center UI from V2-18, or should that be a later integration?

## Suggested Future Milestones

### GUI-R1: Visual Shell Redesign

- Rebuild the main layout to match the screenshot.
- Keep existing kernel-host behavior.
- Use live project/file/task state where already available.
- Allow some cards to use placeholder/demo state if kernel APIs are not ready.

### GUI-R2: Live Agent Panel

- Connect plan/search/edit/test/patch cards to real V2 event streams.
- Normalize event-adapter output for UI cards.
- Add empty/loading/error states.

### GUI-R3: Editor and Terminal Polish

- Improve file preview/editor behavior.
- Improve terminal panel and command output display.
- Add responsive resizing and keyboard shortcuts.

### GUI-R4: Recovery Center Integration

- If V2-18 recovery APIs exist, expose pending approvals, recovered transactions, blocked recovery, and preserved artifact paths in the right panel or a dedicated inspector.

## Non-Goals For First GUI Redesign Pass

- Do not rewrite the kernel.
- Do not change V2 recovery implementation.
- Do not introduce a full IDE editor engine unless explicitly chosen.
- Do not implement a new provider/model layer.
- Do not combine this with V2-18 recovery commits.

## Final Note

The GUI redesign is valuable, but it should be treated as a future product milestone after V2 runtime/recovery stability is improved. The current `DeepSeekCodeIDE.jsx` file should remain as the visual reference until a dedicated design/spec session begins.
