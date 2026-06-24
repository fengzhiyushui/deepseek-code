# V2-11 Transactional Edit & Dirty Workspace Safety Design

> Status: design approved for implementation plan
> Date: 2026-05-31
> Scope: transactional diff apply, stronger change records, dirty rollback conflict detection, and force rollback support

## 1. Purpose

V2 can now apply diffs through the V2 runtime, verify changes, and repair failures. The weak point is still the edit write path: `applyUnifiedDiff()` writes one file after another, and if a later file fails, earlier files remain modified. Rollback also restores `before` content without checking whether the file has been changed after the original edit.

V2-11 turns edit apply and rollback into a safer base layer for future conversation rewind. The goal is not to implement rewind yet. The goal is to make every file write produce enough durable metadata to be safely committed, automatically restored on apply failure, and conflict-checked on rollback.

## 2. Goals

1. Make `EditService.apply()` transactional for all files touched by a diff.
2. Restore all touched files to their pre-apply state if apply fails.
3. Add before/after hashes to change records.
4. Detect dirty workspace conflicts during rollback.
5. Default rollback to safe refusal when conflicts exist.
6. Support explicit `force: true` rollback that overwrites conflicts.
7. Keep existing `diff_preview`, `diff_apply`, `edit`, and `diff_rollback` tools compatible.
8. Publish safe transaction and rollback conflict events without raw diff or file content.
9. Keep all V2-0 through V2-10 tests passing.

## 3. Non-Goals

- No conversation-level rewind.
- No session branch/fork model.
- No GUI rewind panel.
- No durable approval resume after process restart.
- No AST-aware merge or conflict resolution.
- No three-way merge.
- No binary file edit support.
- No change to the existing unified diff grammar beyond stricter transaction handling.

## 4. Current Behavior

`src/edits/edit-service.js` currently applies edits with this flow:

```js
const plan = await store.capture({ diff: parsed.diff, prompt });
await applyUnifiedDiff(parsed.diff, projectRoot);
const record = await store.finalize(plan);
```

The underlying `src/patch.js` function applies patches sequentially:

```js
for (const patch of patches) {
  const updated = applyPatchToText(original, patch);
  await fs.writeFile(target, updated, "utf8");
}
```

If patch 1 writes successfully and patch 2 fails, patch 1 remains written. `rollbackChange()` later writes `before` content back without checking whether the current file still matches the recorded `after` content.

## 5. Chosen Approach

Use a focused edit transaction layer under `src/edits/`.

```text
src/edits/
  edit-transaction.js     # transactional apply and rollback preflight helpers
  edit-service.js         # public V2 edit facade, delegates write safety
  change-store.js         # wraps legacy change persistence
  rollback-service.js     # wraps legacy rollback, enhanced to accept force
```

The transaction layer owns write safety:

```text
parse diff
 -> assert paths safe
 -> build touched file snapshots
 -> capture legacy change plan
 -> apply unified diff
 -> on failure restore snapshots
 -> finalize record with before_hash/after_hash
 -> publish safe events
```

Rollback becomes:

```text
load change record
 -> compare current file hash with recorded after_hash
 -> if dirty and force=false: return conflict, write nothing
 -> if clean or force=true: restore before state
 -> publish rollback applied or conflict event
```

This preserves mature V0 patch parsing and change storage while adding V2 safety guarantees around them.

## 6. Transaction Model

### 6.1 File Snapshot

Each touched file has a snapshot:

```js
{
  path: "src/a.js",
  oldPath: "src/a.js",
  newPath: "src/a.js",
  status: "modify",
  existed_before: true,
  before_hash: "sha256:...",
  before_bytes: 120,
  before_mtime_ms: 1780000000000
}
```

For created files:

```js
{
  status: "create",
  existed_before: false,
  before_hash: null,
  before_bytes: 0
}
```

If a diff claims to create a file (`--- /dev/null`) but the target already exists, V2-11 refuses the edit before applying it. Treating that case as a normal create would make rollback delete a pre-existing user file, so the conservative behavior is the only safe default.

For deleted files, `before_hash` records the deleted file content.

### 6.2 Enhanced Change Record

Existing change records are kept compatible but each `files[]` item gains metadata:

```js
{
  path: "a.txt",
  oldPath: "a.txt",
  newPath: "a.txt",
  status: "modify",
  before: "old\n",
  after: "new\n",
  before_hash: "sha256:...",
  after_hash: "sha256:...",
  before_bytes: 4,
  after_bytes: 4,
  transaction_id: "tx_..."
}
```

For legacy records that do not contain hashes, rollback computes hashes from stored `before` and `after` content when available. If `after` is missing, dirty checking is best-effort and should fail safe for modified existing files unless `force: true`.

### 6.3 Transaction Result

Successful apply returns:

```js
{
  transaction_id,
  change_id,
  files,
  summary,
  diff_hash,
  diff_size,
  restored_on_failure: false
}
```

Failed apply throws an error after restoring snapshots. The error should expose safe metadata:

```js
{
  transaction_id,
  restored: true,
  restored_files: ["a.txt"],
  failed_files: ["b.txt"],
  reason: "patch context mismatch"
}
```

No raw diff or file content is placed in events.

## 7. Apply Failure Semantics

If applying a diff fails:

1. Restore every file in the transaction snapshot to its before state.
2. For files that did not exist before, delete them.
3. For files that existed before, recreate parent directories and write the exact `before` content.
4. Publish `file:transaction_failed` with `transaction_id`, files, restored_files, and a short error message.
5. Do not publish `file:diff_applied`.
6. Do not write a successful change record.

If restoration itself fails, return or throw a stronger error that includes `restore_failed: true` and the affected file list. That case should be rare and must not be reported as a successful edit.

## 8. Rollback Dirty Workspace Semantics

Rollback checks current file state against the change record's `after_hash`.

### 8.1 Default Rollback

Default behavior is safe refusal plus conflict report.

```js
const result = await service.rollback({ change_id, force: false });
```

If any conflict exists:

```js
{
  status: "conflict",
  content: [{ type: "text", text: "Rollback blocked by dirty files..." }],
  metadata: {
    change_id,
    conflicts: [
      {
        path: "a.txt",
        status: "modify",
        expected_after_hash: "sha256:...",
        current_hash: "sha256:...",
        reason: "dirty"
      }
    ],
    force_available: true
  }
}
```

No file is changed when conflicts exist and `force` is false.

### 8.2 Force Rollback

Force rollback is explicit:

```js
await service.rollback({ change_id, force: true });
```

It overwrites current files with the recorded `before` state even if conflicts exist. The result metadata and event metadata must include:

```js
{
  forced: true,
  conflicts: [...]
}
```

Force still goes through the normal tool permission system because `diff_rollback` remains a `write_update` tool.

## 9. Events

Register these safe session events:

```text
file:transaction_started
file:transaction_committed
file:transaction_failed
file:transaction_rolled_back
file:rollback_conflict
```

Payloads may include:

```js
{
  transaction_id,
  change_id,
  files,
  summary,
  diff_hash,
  diff_size,
  restored_files,
  conflicts,
  forced
}
```

Payloads must not include:

- raw diff
- file contents
- snippets
- absolute paths
- API keys
- model reasoning content

Existing events remain:

- `file:diff_applied`
- `file:rollback_applied`

`file:transaction_committed` should be published before or near `file:diff_applied`. `file:transaction_rolled_back` should be published before or near `file:rollback_applied`.

## 10. Tool API Changes

`diff_rollback` gains a boolean `force` parameter:

```js
diff_rollback({
  change_id: "latest",
  force: false
})
```

Backward compatibility:

- Existing calls with only `change_id` still work.
- Missing `force` defaults to false.
- `edit` and `diff_apply` preserve existing params and behavior.

## 11. CLI/TUI/GUI Behavior

V2-11 does not require a UI redesign.

Minimum behavior:

- CLI/tool output for conflict should clearly say rollback was blocked.
- GUI/TUI can show the existing `tool:result` and `file:rollback_conflict` events through current event adapters.
- Full conflict resolution UI is deferred to a later GUI phase.

## 12. Security and Privacy

Required invariants:

- All paths still pass through V2 workspace path safety before writing.
- No rollback writes outside the project root.
- No raw diff or file content in transaction events.
- Dirty rollback refuses by default.
- Force rollback requires explicit `force: true`.
- Tool executor still decides permission from registered tool metadata, not model-supplied category.
- Transaction failure must not leave partially applied files when restoration succeeds.

## 13. Testing Strategy

Unit tests:

- Transaction snapshot reads existing, created, deleted files.
- Multi-file apply failure restores earlier writes.
- Successful apply records before/after hashes.
- Dirty rollback returns conflict and writes nothing.
- Force rollback overwrites dirty files and reports conflicts.
- Legacy records without hashes remain rollback-compatible where possible.

Integration tests:

- `kernel diff_apply` emits transaction and diff events.
- `kernel diff_rollback` blocks dirty rollback.
- `kernel diff_rollback force:true` restores.
- Events contain no raw diff or file content.

Regression:

- Full `npm.cmd test`.
- Full `npm.cmd run check`.
- `git diff --check`.
- No `.deepseek-code/v2` pollution from tests.

## 14. Acceptance Criteria

V2-11 is complete when:

1. A multi-file diff failure leaves the workspace exactly as it was before apply.
2. Successful change records contain before/after hashes for every touched file.
3. Default rollback refuses dirty files and returns a conflict report.
4. Force rollback can explicitly overwrite dirty files.
5. Rollback conflict writes no files.
6. Transaction events are persisted and do not leak file contents.
7. Existing edit and rollback tools remain backward compatible.
8. Full tests, syntax check, whitespace check, and pollution checks pass.

## 15. Deferred Work

- Conversation-level rewind.
- Timeline branch/fork model.
- GUI conflict resolution panel.
- Durable approval/repair resume after process restart.
- Three-way merge.
- Transaction log compaction.

## 16. Final Summary

V2-11 makes edits trustworthy. It turns a sequential patch writer into a transaction-aware edit layer and makes rollback safe by default. This is the right foundation for future node-level conversation rewind because every later rewind operation will depend on precise, conflict-aware file restoration.
