# V2-13 Rewind Hardening & Recovery Design

> Status: proposed
> Date: 2026-05-31
> Scope: make V2-12 rewind apply recoverable when rollback succeeds but branch finalization fails

## 1. Purpose

V2-12 added branch-aware conversation rewind. Its remaining critical risk is partial completion: `rewind.apply()` can roll back workspace files first, then fail while creating or activating the child branch. That leaves the workspace at the rewound file state while session branch metadata still points at the old branch.

V2-13 hardens rewind as an operation with compensation. If rewind cannot finish, it should either restore the workspace to the state from before the rewind attempt, or return an explicit unrecoverable result with safe audit metadata.

## 2. Goals

1. Capture workspace snapshots for all files touched by the rewind rollback plan before applying any rollback.
2. Restore those snapshots when rewind fails after one or more rollbacks have succeeded.
3. Cover branch creation failure and branch activation failure.
4. Cover mid-rollback non-conflict failure after earlier rollbacks succeeded.
5. Keep dirty conflict behavior unchanged: conflict stops without compensation unless earlier rollbacks already happened.
6. Publish safe recovery events that do not contain raw diffs or file contents.
7. Keep successful V2-12 rewind behavior unchanged.
8. Keep `kernel.session.rewind.preview()` read-only.
9. Avoid new dependencies.
10. Avoid `.deepseek-code/v2` pollution in tests.

## 3. Non-Goals

- No GUI branch tree or rewind panel.
- No branch comparison UI.
- No Git integration.
- No durable resume of an interrupted recovery after process crash.
- No mutation of existing JSONL events.
- No three-way merge.
- No rewriting V2-11 edit transactions.
- No automatic retry policy for storage failures.

## 4. Current Risk

Current V2-12 apply flow is:

1. Preview target and compute rollback change IDs.
2. Roll back each change through `editService.rollback()`.
3. Create child branch.
4. Activate child branch.
5. Publish success events.

The unsafe window is between the first successful rollback and final branch activation. Any failure in that window can leave files changed without the matching branch state.

The highest priority failure modes are:

- `createBranch()` throws after all rollback calls succeed.
- `activateBranch()` throws after branch creation succeeds.
- `rollback()` returns failed for change N after earlier changes were already rolled back.

Dirty conflicts are different. A conflict means rollback refused to write because current files are dirty. If conflict happens before any rollback succeeds, nothing needs restoring. If conflict happens after earlier rollback calls succeeded, V2-13 should restore those earlier file changes before returning the conflict result.

## 5. Chosen Architecture

Add a small rewind transaction helper:

```text
src/sessions/rewind-transaction.js
```

This module owns file snapshot and restore for rewind plans. It should not know about branches, event logs, or checkpoints. It only needs a project root and a rollback plan.

`rewind-service.js` remains the orchestrator:

```text
preview -> begin transaction -> rollback loop -> create branch -> activate branch -> commit
                                     |
                                     + failure/conflict -> restore snapshots -> publish recovery event
```

`src/index.js` injects `projectRoot` into `createRewindService()` so the service can create a rewind transaction.

## 6. Rewind Transaction Model

The transaction captures the current content/state of every file that may be affected by the rollback plan.

Input:

```js
{
  projectRoot,
  files: ["src/a.js", "src/b.js"]
}
```

Snapshot record:

```js
{
  path: "src/a.js",
  existed_before: true,
  before: "...",
  before_hash: "sha256:...",
  before_bytes: 123
}
```

For missing files:

```js
{
  path: "src/new.js",
  existed_before: false,
  before: null,
  before_hash: null,
  before_bytes: 0
}
```

Restore rules:

- Existing files are written back exactly as captured.
- Missing files are removed if they were created during rewind.
- Empty parent directories created during rewind may be removed best-effort.
- All paths must go through existing workspace path safety helpers.
- Snapshot records are kept in memory only and must not be published to events.

## 7. Rewind Apply State Flow

V2-13 should make apply states explicit in result metadata and events:

```text
previewed
started
rollback_applied
branch_created
branch_activated
committed
failed_restored
failed_unrestorable
conflict_restored
```

Successful result shape stays compatible:

```js
{
  status: "success",
  previous_branch_id: "br_main",
  branch_id: "br_child",
  rollback_change_ids: ["change_2"],
  applied_rollbacks: ["change_2"],
  files: ["b.txt"],
  forced: false,
  recovery: null
}
```

Recovered failure result:

```js
{
  status: "failed_restored",
  current_branch_id: "br_main",
  attempted_branch_id: "br_child",
  phase: "create_branch",
  applied_rollbacks: ["change_2"],
  restored_files: ["b.txt"],
  reason: "branch_create_failed"
}
```

Unrecoverable failure result:

```js
{
  status: "failed_unrestorable",
  current_branch_id: "br_main",
  attempted_branch_id: "br_child",
  phase: "restore",
  applied_rollbacks: ["change_2"],
  restored_files: [],
  restore_error: "restore_failed",
  reason: "branch_create_failed"
}
```

## 8. Error Sanitization

Events must not include raw error messages from patching, file contents, raw diffs, or model output.

Add a category helper in `rewind-service.js` or `rewind-transaction.js`:

```js
safeRewindError(error, phase)
```

Allowed categories:

- `rollback_failed`
- `branch_create_failed`
- `branch_activate_failed`
- `restore_failed`
- `rewind_failed`

The returned string must not include `error.message`.

## 9. Events

Register and publish:

```text
session:rewind_restore_started
session:rewind_restored
session:rewind_recovery_failed
```

Event payloads must contain only safe metadata:

```js
{
  current_branch_id,
  attempted_branch_id,
  phase,
  applied_rollbacks,
  restored_files,
  reason,
  forced
}
```

They must not contain:

- `before`
- `after`
- `snippet`
- `diff --git`
- `@@`
- raw exception text

Existing events stay:

- `session:rewind_started`
- `session:rewind_applied`
- `session:rewind_conflict`
- `session:rewind_failed`

V2-13 may continue publishing `session:rewind_failed`, but recovered failures should also publish `session:rewind_restored`.

## 10. Branch Store Behavior

V2-13 does not need full branch-store transactions.

If `createBranch()` fails, no branch exists and restoring files is enough.

If `activateBranch()` fails after `createBranch()` succeeds, the child branch metadata may exist but active branch remains old. V2-13 should restore files and return `failed_restored`. It does not need to delete the branch record, because branch deletion is not currently part of the branch-store API. The failed child branch should be harmless because it is inactive. A future cleanup phase can add branch pruning.

## 11. Kernel Wiring

`createKernel()` should pass `projectRoot: root` to `createRewindService()`.

If a test injects a custom rewind service or branch store, no behavior changes.

If `branchStore` is unavailable, rewind remains unavailable as in V2-12.

## 12. CLI/GUI Surface

No new active UI is required.

Minimum interface updates:

- CLI event renderer should summarize the three new recovery events.
- GUI host delegates do not need changes because they already call `rewindPreview()` and `rewindApply()`.
- GUI renderer can remain unchanged unless tests already cover event summaries through the adapter.

## 13. Testing Strategy

Unit tests:

- `captureRewindSnapshots()` captures existing and missing files.
- `restoreRewindSnapshots()` restores modified files and removes files created during failed rewind.
- `rewind.apply()` restores files when `createBranch()` fails after rollback success.
- `rewind.apply()` restores files when `activateBranch()` fails after branch creation.
- `rewind.apply()` restores earlier successful rollbacks when a later rollback fails.
- `rewind.apply()` restores earlier successful rollbacks when a later rollback conflicts.
- Recovery events contain no raw content.

Integration tests:

- Real kernel: apply two edits, inject branch creation failure, verify files return to pre-rewind state and active branch remains unchanged.
- Real kernel: inject branch activation failure, verify files return to pre-rewind state and active branch remains unchanged.
- Timeline includes recovery event metadata and no file content.

Regression:

- Full `npm.cmd test`.
- Full `npm.cmd run check`.
- `git diff --check`.
- No `.deepseek-code/v2` pollution from tests.

## 14. Acceptance Criteria

V2-13 is complete when:

1. Rewind success behavior from V2-12 still passes.
2. Branch creation failure after rollback restores workspace files.
3. Branch activation failure after rollback restores workspace files.
4. Mid-rollback failure after earlier rollback restores workspace files.
5. Mid-rollback conflict after earlier rollback restores workspace files.
6. Recovery events are registered and persisted.
7. Recovery events do not leak raw diffs, file contents, snippets, or raw exception messages.
8. Active branch remains unchanged on failed or restored rewind.
9. Tests do not create `.deepseek-code/v2` under repo root.
10. Full regression passes.

## 15. Deferred Work

- Delete or mark failed inactive child branches after activation failure.
- Durable recovery resume after process crash during restore.
- GUI branch/recovery panel.
- Branch comparison and pruning.
- Recovery retry UI.

## 16. Final Summary

V2-13 turns rewind apply from a best-effort sequence into a recoverable operation. It does not make branch metadata fully transactional, but it closes the dangerous gap where files could be rewound while the session still points at the old branch.
