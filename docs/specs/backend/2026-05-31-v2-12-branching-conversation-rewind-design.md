# V2-12 Branching Conversation Rewind Design

> Status: heavy-route design selected
> Date: 2026-05-31
> Scope: branch-aware session timeline, checkpoint manifest, rewind preview/apply, and active-branch continuation

## 1. Purpose

V2-11 made file edits safe enough to use as a foundation for conversation-level rewind. V2-12 adds the missing session semantics: selecting an earlier timeline node should not merely undo files. It should create a new conversation branch, restore the workspace to the selected node, and make all future turns continue on that new branch while the old branch remains inspectable.

This is the heavy route. The project should model rewind as a branch/fork operation, not as destructive timeline deletion.

## 2. Goals

1. Add durable branch metadata for V2 sessions.
2. Mark every new event with a `branch_id`.
3. Track an active branch for each session.
4. Build checkpoints from the append-only event log.
5. Support rewind preview to a target event, sequence, or turn.
6. Support rewind apply that creates a new branch.
7. Restore files by rolling back V2-11 change records in reverse order.
8. Refuse dirty conflicts by default and return a conflict report.
9. Support explicit `force: true` rewind that forwards force to rollback.
10. Keep old branches and events intact.
11. Keep existing `session.getTimeline(count)` compatible.
12. Expose branch-aware APIs through `kernel.session`.

## 3. Non-Goals

- No GUI branch tree panel in V2-12.
- No visual diff UI for branch comparison.
- No automatic model context replay across branches beyond event filtering.
- No deletion of old timeline events.
- No mutation of existing JSONL event rows.
- No three-way merge.
- No Git branch integration.
- No durable approval/repair resume across restart; this remains a later phase.

## 4. Current State

The current session layer is append-only JSONL:

```text
src/sessions/event-log.js       # hash-chain JSONL storage
src/sessions/session-manager.js # EventBus -> EventLog bridge, subscribe, getTimeline
src/index.js                    # exposes kernel.session
```

Events are durable but linear. `session.getTimeline(count)` returns the last events in the session log. There is no `branch_id`, no active branch state, and no checkpoint index.

Edit events already carry the data needed for file rewind:

- `file:diff_applied`
- `file:transaction_committed`
- `file:rollback_applied`
- `file:transaction_rolled_back`
- `file:rollback_conflict`

V2-11 rollback refuses dirty files by default and supports explicit force. V2-12 must call that path instead of writing files directly.

## 5. Chosen Architecture

Add branch-aware session services under `src/sessions/`:

```text
src/sessions/branch-store.js       # durable active branch and branch metadata
src/sessions/checkpoint-index.js   # derive checkpoints and change ranges from timeline
src/sessions/rewind-service.js     # preview/apply rewind using editService.rollback()
src/sessions/session-manager.js    # stamp events with active branch_id
src/index.js                       # expose kernel.session.branches/rewind APIs
```

The event log stays append-only. Rewind creates new events:

```text
session:branch_created
session:branch_activated
session:rewind_preview
session:rewind_started
session:rewind_applied
session:rewind_conflict
session:rewind_failed
```

Existing events are never edited. Existing event hashes remain valid.

## 5.1 Phased Delivery

The architecture is the heavy branch/fork route, but implementation should be staged so each phase is independently testable:

| Phase | Name | Deliverable |
|---|---|---|
| V2-12A | Branch Foundation | Durable branch store, active branch, event stamping, branch-aware timeline filtering |
| V2-12B | Checkpoint Index | Checkpoint derivation from timeline, target resolution, change range planning |
| V2-12C | Rewind Apply | Preview/apply rewind, reverse rollback, conflict handling, child branch activation |
| V2-12D | Interface Hooks | Kernel facade completion, GUI host IPC-ready methods, CLI/TUI event summaries |

This still counts as the heavy route because the data model is branch-first from the beginning. The phases only reduce implementation risk.

## 6. Branch Model

### 6.1 Branch Record

Each branch is stored in a metadata JSON file:

```js
{
  schema_version: 1,
  session_id: "sess_...",
  active_branch_id: "br_main",
  branches: [
    {
      branch_id: "br_main",
      parent_branch_id: null,
      forked_from_event_id: null,
      forked_from_seq: 0,
      forked_from_turn_id: null,
      created_at: "2026-05-31T00:00:00.000Z",
      label: "main"
    },
    {
      branch_id: "br_abc123",
      parent_branch_id: "br_main",
      forked_from_event_id: "evt_...",
      forked_from_seq: 42,
      forked_from_turn_id: "turn_...",
      created_at: "2026-05-31T00:01:00.000Z",
      label: "rewind to turn_..."
    }
  ]
}
```

The default branch is `br_main`. If a V2-11 or older session has no branch file, V2-12 creates `br_main` lazily and treats events without `branch_id` as belonging to `br_main`.

### 6.2 Event Branch Stamping

`SessionManager` receives a `getActiveBranchId()` callback. When it persists or forwards an event, it adds:

```js
{
  branch_id: "br_main"
}
```

If the event already includes a `branch_id`, the active branch still wins for normal runtime events. Reserved event fields such as `type` must remain protected exactly as they are today.

Branch control events may include both:

```js
{
  branch_id: "br_new",
  parent_branch_id: "br_main"
}
```

## 7. Checkpoint Model

V2-12 derives checkpoints from the timeline instead of creating a separate source of truth.

Checkpoint shape:

```js
{
  checkpoint_id: "cp_...",
  branch_id: "br_main",
  event_id: "evt_...",
  seq: 42,
  turn_id: "turn_...",
  type: "turn" | "event",
  label: "after turn turn_...",
  change_ids: ["20260531120000"],
  cumulative_change_ids: ["20260531115900", "20260531120000"]
}
```

The checkpoint index must support:

- find target by `event_id`
- find target by `seq`
- find target by `turn_id`
- list branch checkpoints
- compute changes after target on a branch

For legacy events without branch ids, `branch_id` is normalized to `br_main`.

## 8. Rewind Semantics

### 8.1 Preview

Preview is read-only:

```js
await kernel.session.rewind.preview({
  target: { turn_id: "turn_1" }
});
```

Returns:

```js
{
  status: "success",
  target,
  current_branch_id: "br_main",
  planned_branch_id: "br_...",
  rollback_change_ids: ["change_3", "change_2"],
  rollback_count: 2,
  files: ["src/a.js"],
  force_required: false
}
```

Preview publishes `session:rewind_preview` with safe metadata only. It must not write files or change active branch.

### 8.2 Apply

Apply creates a new branch and rolls back changes after the target:

```js
await kernel.session.rewind.apply({
  target: { turn_id: "turn_1" },
  force: false
});
```

Flow:

1. Flush pending session events.
2. Load timeline and active branch.
3. Resolve target checkpoint.
4. Compute change IDs after target on the active branch.
5. Publish `session:rewind_started`.
6. Roll back changes in reverse chronological order through `editService.rollback({ change_id, force })`.
7. If any rollback returns conflict, stop immediately.
8. Publish `session:rewind_conflict` and keep active branch unchanged.
9. If all rollbacks succeed, create a new child branch.
10. Activate the new branch.
11. Publish `session:branch_created`, `session:branch_activated`, and `session:rewind_applied`.

New turns after a successful rewind belong to the new branch.

### 8.3 Conflict

Default rewind refuses dirty conflicts:

```js
{
  status: "conflict",
  current_branch_id: "br_main",
  attempted_branch_id: "br_new",
  failed_change_id: "change_2",
  applied_rollbacks: ["change_3"],
  remaining_change_ids: ["change_2"],
  conflicts: [...]
}
```

Because rollbacks happen one by one, a conflict can occur after earlier rollbacks have succeeded. In that case V2-12 must report partial progress clearly. It must not pretend the branch was activated.

### 8.4 Force

Force rewind forwards `force: true` into each V2-11 rollback call. Events must include `forced: true` and conflict metadata returned by forced rollbacks.

Force still must not bypass workspace path safety.

## 9. Branch Timeline Query

Keep the existing API compatible:

```js
await kernel.session.getTimeline(50);
```

This continues to return the latest events, but V2-12 should prefer the active branch by default.

Add branch-aware options:

```js
await kernel.session.getTimeline({ count: 50, branch_id: "br_main" });
await kernel.session.getTimeline({ count: 50, all_branches: true });
```

Rules:

- Numeric argument keeps old behavior: active branch, `count = n`.
- `all_branches: true` returns all events.
- `branch_id` returns events from that branch plus inherited ancestor events up to the fork point.
- Events without `branch_id` are treated as `br_main`.

## 10. Kernel API

Expose:

```js
kernel.session.branches.list()
kernel.session.branches.getActive()
kernel.session.branches.activate(branch_id)
kernel.session.checkpoints.list({ branch_id })
kernel.session.rewind.preview({ target, branch_id })
kernel.session.rewind.apply({ target, branch_id, force })
```

`activate()` only changes active branch metadata. It does not change files. It is for viewing/continuing an already-valid branch, not for rewind.

## 11. CLI/TUI/GUI Minimum Surface

V2-12 is primarily kernel-level.

Minimum interface changes:

- CLI helper functions may be added for tests, but no full CLI command is required.
- GUI host should expose `rewindPreview`, `rewindApply`, `listBranches`, and `listCheckpoints` for future renderer work.
- TUI may continue rendering events as plain event summaries.

Full GUI branch tree belongs to V2-13.

## 12. Privacy and Security

Required invariants:

- Rewind events must not include raw diffs or file contents.
- Branch metadata must not include snippets or model reasoning.
- Rewind file writes must only happen through V2-11 rollback.
- Dirty conflict refuses by default.
- Force must be explicit.
- Branch activation must not write files.
- Existing event hash chain remains append-only and valid.
- Tests must not create `.deepseek-code/v2` under the repository root.

## 13. Testing Strategy

Unit tests:

- Branch store creates `br_main` lazily.
- Branch store persists active branch and child branch records.
- Session manager stamps active `branch_id` onto events.
- Timeline filtering returns active branch plus inherited ancestors.
- Checkpoint index resolves target by event, seq, and turn.
- Rewind planner computes reverse change order.
- Rewind service preview is read-only.
- Rewind service apply creates and activates a new branch.
- Rewind conflict stops and does not activate the new branch.

Integration tests:

- Apply two edits, rewind to first turn, verify second edit is rolled back.
- Rewind creates child branch and future agent turns use child branch id.
- Dirty conflict blocks rewind and leaves active branch unchanged.
- Force rewind succeeds and records forced metadata.
- Reopened kernel keeps active branch metadata.

Regression:

- Full `npm.cmd test`.
- Full `npm.cmd run check`.
- `git diff --check`.
- No `.deepseek-code/v2` pollution from tests.

## 14. Acceptance Criteria

V2-12 is complete when:

1. A session has durable branch metadata and an active branch.
2. New persisted events include the active `branch_id`.
3. Existing branch-less sessions remain readable as `br_main`.
4. Rewind preview reports the exact change IDs that would be rolled back.
5. Rewind apply rolls back target-after changes in reverse order.
6. Successful rewind creates and activates a child branch.
7. Future turns after rewind are written to the child branch.
8. Dirty conflicts stop rewind and leave active branch unchanged.
9. Force rewind is explicit and records forced metadata.
10. Old branch events remain present and queryable.
11. Events and branch metadata do not leak file content.
12. Full verification passes.

## 15. Deferred Work

- GUI branch tree and rewind panel.
- Branch comparison UI.
- Conversation context replay tuned per branch.
- Durable approval/repair resume across process restart.
- Branch pruning or compaction.
- Git branch integration.

## 16. Final Summary

V2-12 turns rewind into a real conversation fork. It preserves the append-only audit log, uses V2-11 rollback for file safety, and gives the runtime a durable active branch so future turns continue from the selected node rather than pretending the old linear timeline was erased.
