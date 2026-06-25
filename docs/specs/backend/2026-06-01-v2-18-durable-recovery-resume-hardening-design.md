# V2-18 Durable Recovery / Resume Hardening Design

> Status: Draft after self-review fixes  
> Date: 2026-06-01  
> Scope: Durable process-crash recovery for approval/repair pauses, agent-managed edit/rewind transactions, single-writer takeover, and a Recovery Center UX

> **As-built note (2026-06-25):** Shipped on `main` as V2-18a/b (durable
> paused-turn recovery: project lock + paused-sidecar persistence + recovery
> inbox/service + CLI `/recovery`) and V2-18c (edit/rewind transaction
> journaling). One deviation from this design: **recovery is opt-in**
> (`createKernel(root, { recovery: { enabled: true } })`), defaulting **off**,
> to match the V2-20 guardrail pattern (kernel = mechanism, config = policy)
> and keep `main`'s default behavior unchanged. `kernel.dispose()` releases
> the project lock. The "Recovery Center UX" remains a CLI-facing facade
> (`kernel.recovery.*`); a GUI panel is deferred. See `CHANGELOG.md`.

## 1. Purpose

V2-17 unified chat on the V2 kernel and closed the major provider bypass. The remaining 1.0 reliability gap is recovery after a CLI, TUI, GUI, or renderer process dies while the V2 runtime is paused or mutating local project state.

Today approval, repair, and rewind recovery are in-process only. The key resume records live in `pausedTurnStore`, an in-memory `Map`; rewind compensation snapshots are memory-only; and there is no project-level writer lock. If the process exits at the wrong time, the next process may be blind to a pending approval, may accept new turns despite a prior paused state, or may find partially-applied local files without a durable undo plan.

V2-18 adds process-crash durable recovery while preserving the V2 architecture: no daemon, no Git replacement, no full hook platform, and no auto-redo of destructive operations.

## 2. Goals

1. Persist paused approval and repair records so a restart can list, resume, or cancel them.
2. Preserve the original autonomy and permission semantics of a paused turn across restart.
3. Journal agent-managed edit and rewind transactions before mutation so interrupted transactions can be rolled back on the next launch.
4. Keep previously committed transactions intact; roll back only the interrupted transaction.
5. Support a single active writer per project with an interactive Take over / Cancel flow and noninteractive fail-closed behavior.
6. Add a Recovery Center surface shared by CLI/TUI/GUI.
7. Emit payload-free recovery lifecycle events that can become future hook points.
8. Keep sensitive payloads out of events, logs, exports, and user-facing error text.
9. Add deterministic fault-injection tests for recovery boundaries.

## 3. Non-Goals

1. No power-loss, OS-crash, disk/controller failure, network filesystem, or fsync-grade durability.
2. No read-only observer mode for a second process.
3. No full external hook system.
4. No auto-redo or auto-finish of destructive edit/rewind operations after restart.
5. No rollback guarantee for arbitrary shell commands, build tools, external editors, manual user edits, or OS-level mutations.
6. No Git replacement and no full version-control semantics.
7. No cross-machine or shared-network workspace concurrency support.
8. No raw `resume_state`, prompt, diff, file content, or undo-data emission in the event log.

## 4. Current State and Risks

### 4.1 Approval and repair pauses

The V2 runtime is owned by `createAgentRuntime()` in `src/core/runtime/agent-runtime.js`. `send()` stores an `awaiting_approval` record in `pausedTurnStore`; `approve()` consumes it through the single resume entry point.

The current paused record is already the right logical unit:

```js
{
  approval_id,
  turn_id,
  approval,
  turn,
  resume_state,
  created_at,
}
```

But the store is an in-memory `Map`. The `resume_state` includes full model messages, tool schemas, the pending tool call, remaining tool calls, accumulated tool results, and repair context when applicable. None of that is currently durable.

Repair resume also has a field-shape bug that V2-18 must fix before serializing records: `agent-runtime.js` reads `ctx.initial_tool_results`, but the repair loop currently does not persist that field in `repair_context`.

### 4.2 Edit and rewind transactions

Transactional edit support currently snapshots touched files in memory before applying a diff, and restores those snapshots on in-process failure. Committed change records under `.deepseek-code/changes/` include before/after content and hashes, but there is no write-ahead transaction journal for an interrupted apply.

Rewind recovery similarly captures snapshots in memory before rollback, then restores them on in-process branch or rollback failure. The V2-13 rewind hardening design explicitly deferred durable recovery after process crash.

### 4.3 Concurrency

There is no cross-process lock or single-writer guard. Most per-session files do not collide because each kernel boot gets a fresh `sessionId`, but managed workspace file edits, rewind apply, recovery, branch metadata, journal files, paused sidecars, and event markers must not be mutated by two active writers at once.

### 4.4 Event-log constraints

The append-only session event log is the correct audit timeline, but it must not carry heavy recovery payloads. Prior V2 specs prohibit raw diffs, file contents, snippets, prompts, model reasoning, and secrets in events. V2-18 must preserve that invariant.

## 5. Chosen Architecture

V2-18 uses sidecar payload stores plus payload-free event markers.

```text
.deepseek-code/v2/
├── .lock/
│   ├── owner.json                  # project writer lease, heartbeat, owner epoch
│   └── takeover/<requestId>.json   # cooperative takeover requests
├── sessions/<projectId>/
│   ├── <sessionId>.jsonl          # existing event log + payload-free markers
│   ├── <sessionId>.branches.json  # existing branch state
│   └── paused/<approvalId>.json   # new project-scoped paused approval/repair sidecar
├── journal/<txId>/
│   ├── manifest.json              # new edit/rewind transaction journal
│   └── blobs/<blobId>             # preimage bytes when needed
├── recovered/<txId>/
│   ├── manifest.json              # preserved conflict/unknown current state
│   └── blobs/<blobId>
└── recovery/inbox.json            # user-visible Recovery Center state
```

The event log receives only safe lifecycle markers. The sidecars and journals are local private state and are the authoritative payload stores. The Recovery Center persists only summaries and references to sidecars/journals/recovered artifacts, not raw payload bytes.

### 5.1 Proposed modules

Create:

- `src/core/recovery/atomic-file.js` — atomic temp-file-then-rename helpers for JSON and byte blobs.
- `src/core/recovery/recovery-faults.js` — deterministic test-only fault injection labels.
- `src/core/recovery/project-lock.js` — single-writer lease, heartbeat, takeover requests, owner epoch fencing.
- `src/core/recovery/paused-turn-persistence.js` — paused sidecar save/load/delete/quarantine.
- `src/core/recovery/transaction-journal.js` — journal create/update/commit/delete/scan and recovered artifact writes.
- `src/core/recovery/recovery-inbox.js` — persisted Recovery Center item model.
- `src/core/recovery/recovery-service.js` — boot recovery orchestration, structured reports, Recovery Center API.
- `src/core/recovery/recovery-errors.js` — sanitized error categories.

Modify:

- `src/index.js` — wire recovery service and give `session.resume()` real behavior.
- `src/core/runtime/agent-runtime.js` — persist paused records, list/cancel paused records, resume using original safety context.
- `src/core/approval/paused-turn-store.js` — wrap `save/take/deleteForTurn/clear` with explicit persistence callbacks so sidecars are maintained whenever in-memory records change.
- `src/core/verification/repair-loop.js` — include required `repair_context.initial_tool_results` on every repair approval pause.
- `src/core/execution/executor-loop.js` — ensure resume state carries stable autonomy and permission metadata.
- `src/edits/edit-transaction.js` and `src/edits/edit-service.js` — journal before mutation and commit/abort through recovery journal.
- `src/sessions/rewind-service.js` and `src/sessions/rewind-transaction.js` — journal durable pre-rewind file and branch state before apply.
- `src/sessions/event-types.js`, `src/sessions/session-manager.js`, and renderers — add recovery lifecycle markers and awaited marker flush support.
- `src/apps/cli/kernel-runner.js` — add `/recovery` commands and takeover prompt.
- GUI kernel host / renderer — expose Recovery Center list and actions through the same kernel API.

## 6. Failure Model and Atomic Write Rules

V2-18 durability covers deepseek-code process death, including uncaught exceptions and process kill after an awaited write/close/rename operation.

It does not claim durability across:

- OS or kernel crash;
- hard power loss;
- disk, controller, or filesystem failure;
- network filesystem rename anomalies;
- antivirus or permission interference;
- writes accepted by the OS but later lost because this design intentionally does not fsync.

Atomic writes use a unique temp file in the target directory, fully write and close it, then rename into place. Recovery ignores leftover temp files. Atomicity is assumed only within the same directory and filesystem.

For V2-18, this is called process-crash durable, not power-loss durable.

## 7. Project Lock, Takeover, and Fencing

### 7.1 Lock storage and acquisition primitive

`.deepseek-code/v2/.lock/` is a lock directory. Initial acquisition uses `fs.mkdir(lockDir)` as the Windows-compatible exclusive primitive. If creation succeeds, the process writes `owner.json` and owns the project. If the directory already exists, the process reads `owner.json` and classifies the holder as live, stale, released, or corrupt.

`owner.json` stores:

```json
{
  "schema_version": 1,
  "epoch": 7,
  "owner": {
    "token": "owner_uuid",
    "pid": 12345,
    "host": "DESKTOP-ABC",
    "surface": "cli",
    "started_at": "2026-06-01T10:42:00.000Z"
  },
  "session_id": "sess_...",
  "heartbeat_at": "2026-06-01T10:42:05.000Z",
  "phase": "idle|turn|edit|rewind|recovery",
  "released_at": null
}
```

`owner.token` is process-local and unguessable. `epoch` increments on every force takeover. The lock module exposes the only mutating operations for lock files; callers must not write lock files directly.

Heartbeat cadence is 2 seconds. A holder is considered live on the same host when its PID exists and `heartbeat_at` is younger than 10 seconds. A holder is stale when PID is dead, `released_at` is set, `heartbeat_at` is older than 10 seconds, or the host differs and `heartbeat_at` is older than 30 seconds. These constants are V2-18 defaults and may become config later.

### 7.2 Writer invariant

Only the process whose `(owner.token, epoch)` matches the current `owner.json` may mutate managed V2 state or managed workspace files.

Managed mutations include:

- event-log append;
- paused sidecar create/update/delete/quarantine;
- transaction journal create/update/delete;
- managed edit apply/rollback;
- managed rewind apply/rollback;
- recovery reconciliation;
- branch metadata writes;
- migration of V2 recovery state;
- Recovery Center clear/cancel actions.

Every managed mutating path must call `assertOwner()` immediately before mutation and before commit/success markers. `assertOwner()` reloads `owner.json` and compares `(token, epoch)`. A takeover request is not ownership.

Arbitrary shell commands, external editors, build tools, and OS processes are outside this guarantee unless routed through the V2 transaction journal.

### 7.3 Interactive takeover

If an interactive CLI/TUI/GUI finds a live lock holder, it prompts:

```text
Another deepseek-code session is active.
Owner: gui pid 12345, session sess_..., heartbeat 3s ago, phase edit.
Choose: Take over / Cancel
```

`Cancel` exits or returns to the previous UI without mutating state.

`Take over` creates `.lock/takeover/<requestId>.json` with `fs.open(..., "wx")`. The request includes requester token, requester PID/host/surface, observed owner token, observed epoch, and requested_at. Multiple requesters can create files; the holder chooses the earliest `(requested_at, requestId)` and ignores later requests until the first is resolved. This avoids lost writes because requesters never overwrite `owner.json`.

The holder's heartbeat loop scans `.lock/takeover/`. When it sees the winning request, it publishes `takeover:requested`, interrupts the current turn, aborts or rolls back its own open transaction, writes `released_at`, removes `owner.json`, removes the lock directory if empty, and exits with a message that the session was taken over.

The requester polls until the lock becomes released/stale, then acquires normally through `fs.mkdir(lockDir)` or by reclaiming the released directory. It publishes `takeover:completed` after it owns the lock and recovery has run.

### 7.4 Force takeover and fencing

If the holder does not release within 15 seconds after the takeover request, an interactive requester may confirm force takeover. Noninteractive force takeover requires explicit `takeover: "force"`.

Force takeover writes a new `owner.json` candidate with `epoch = observed_epoch + 1`, a new owner token, and the requester's session id. Because two force requesters may race, ownership is not granted by the write itself. A requester owns the project only after it reads back `owner.json` and sees its exact `(token, epoch)`. If another requester overwrote it, the loser must not mutate and must restart lock acquisition.

A stale holder that later wakes must fail `assertOwner()` because the epoch changed. It must stop before further mutation or success markers.

### 7.5 Noninteractive behavior

One-shot commands, API callers, tests, and background runs fail closed when a live holder exists unless they pass explicit `takeover: "force"` or a test-only takeover override.

No read-only observer mode is implemented in V2-18.

## 8. Paused Approval / Repair Sidecars

### 8.1 Sidecar path and format

Paused sidecars are project-scoped, not current-session-scoped:

```text
.deepseek-code/v2/sessions/<projectId>/paused/<approvalId>.json
```

`projectId` and `approvalId` use the same sanitization rules as session files. Approval ids must be UUID-style or otherwise collision-resistant.

The sidecar stores:

```json
{
  "schema_version": 1,
  "approval_id": "approval_...",
  "turn_id": "turn_...",
  "session_id": "sess_original",
  "created_at": "2026-06-01T10:42:00.000Z",
  "surface": "cli|tui|gui",
  "permission_context": {
    "schema_version": 1,
    "autonomy": "read-only|supervised|gated|auto|full-auto",
    "project_id": "sess_original_or_stable_project_id_used_for_fingerprint",
    "project_root": "workspace-root-used-at-pause",
    "trust_store_rules": [],
    "project_rules": [],
    "memory_root": null,
    "verify_mode": "auto|never|always",
    "test_argv": null
  },
  "approval": {},
  "turn": {},
  "resume_state": {}
}
```

`permission_context` is the serializable subset of `createPolicyContext()` plus verification options required to preserve safety behavior after restart. It must be used on resume instead of current process defaults. In particular, approval-cache fingerprinting must use the stored `project_id`, not a fresh session id minted by the restarted process.

`resume_state` is the full existing resume object required by `resumeExecutorLoop()`, including repair context when present. It is not redacted because redaction would make resume unreliable. For repair approvals, `resume_state.repair_context.initial_tool_results` is required and must be present on every repair approval pause.

The sidecar is private local state and must never be copied into the event log.

### 8.2 Lifecycle and marker flush

On pause:

1. build the paused record;
2. write the sidecar atomically;
3. append payload-free `turn:paused` marker and await `sessionManager.flush()` or a direct event-log append;
4. save into the in-memory `pausedTurnStore`;
5. return `awaiting_approval`.

The sidecar is the payload authority. The event marker is the audit marker and must be flushed before the pause is considered fully durable. If the process crashes after sidecar write but before marker flush, recovery treats the valid sidecar as recoverable and appends a repair marker during scan.

On resume:

1. Recovery Center or approval prompt selects the paused id;
2. validate sidecar;
3. restore the record into the in-memory store if needed;
4. call the existing `agent.approve(approvalId, decision)` path;
5. create policy contexts from stored `permission_context`, with phase-specific override to `auto` only for verifier calls as the current runtime already does;
6. delete the sidecar after the resume path consumes it;
7. append payload-free `turn:resumed` and keep existing `approval:resolved` behavior.

On cancel:

1. delete the in-memory paused record;
2. quarantine the sidecar under `paused/quarantine/` or delete it when valid and already listed;
3. append `turn:cancelled` and flush;
4. show the item as cancelled or cleared in Recovery Center.

On interrupt:

- same cleanup as cancel, but the report says it was interrupted.

### 8.3 Authority, cross-session scan, and mismatch handling

Startup scans every paused sidecar under `.deepseek-code/v2/sessions/<projectId>/paused/` and scans all `.jsonl` files under `.deepseek-code/v2/sessions/<projectId>/` for `turn:paused`, `turn:resumed`, and `turn:cancelled` markers keyed by `approval_id`. A fresh process may have a new `sessionId`; recovery still uses the original sidecar `session_id` and records any recovery actions in the current session.

| State | Action |
|---|---|
| valid sidecar + no resolved/cancelled marker | rehydrate and list in Recovery Center, even if `turn:paused` marker is missing; append a `turn:rehydrated` marker with `marker_status: "paused_marker_missing"` |
| marker + valid sidecar | rehydrate and list in Recovery Center |
| marker without sidecar | create blocked Recovery Center item; no normal sends until user clears unrecoverable item |
| sidecar with resolved/cancelled marker | delete or quarantine as stale cleanup; report cleanup |
| corrupt sidecar | create blocked Recovery Center item; no normal sends until user quarantines or clears it |
| duplicate approval id | create blocked Recovery Center item unless exactly one valid sidecar has matching unresolved marker; quarantine others |

This policy avoids guessing while still recovering the common crash window where the sidecar exists but the marker did not flush.

## 9. Agent-Managed Transaction Journal

### 9.1 Scope and transaction boundary

The rollback guarantee applies to one agent-managed edit tool call or one rewind apply call.

If a turn completes edit transaction A, then starts transaction B and crashes, recovery touches only B. A is already committed and remains intact.

If one edit transaction patches multiple files and crashes partway, recovery rolls back the entire transaction. This matches current in-process transactional semantics and avoids leaving a cross-file change half-applied.

### 9.2 Journal layout

`<root>/.deepseek-code/v2/journal/<txId>/manifest.json` stores:

```json
{
  "schema_version": 1,
  "tx_id": "tx_...",
  "state": "open|aborting|committed",
  "kind": "edit|rewind",
  "session_id": "sess_original",
  "turn_id": "turn_...",
  "owner_epoch": 7,
  "opened_at": "2026-06-01T10:42:00.000Z",
  "phase": "started|applying|branch_created|branch_activated",
  "target": {
    "type": "edit|rewind",
    "description": "safe summary only",
    "rewind_target": null
  },
  "paths": [
    {
      "path": "src/file.js",
      "path_key": "src/file.js",
      "kind": "file|directory|symlink|missing",
      "pre_hash": "sha256:...",
      "pre_size": 123,
      "pre_mtime_ms": 123456789,
      "mode": 420,
      "symlink_target": null,
      "blob": "blobs/abc"
    }
  ],
  "rewind_branch_state": null,
  "final_state": null,
  "commit_id": null
}
```

For `kind: "rewind"`, `rewind_branch_state` is required:

```json
{
  "branch_store_path": ".deepseek-code/v2/sessions/<projectId>/<originalSessionId>.branches.json",
  "original_session_id": "sess_original",
  "state_before": {
    "schema_version": 1,
    "session_id": "sess_original",
    "active_branch_id": "br_main",
    "branches": []
  },
  "created_branch_id": null,
  "activated_branch_id": null
}
```

Recovery restores the branch store at `branch_store_path` to `state_before`. New-session recovery events are written to the current session log and reference `original_session_id` and `tx_id`; old session events are not rewritten.

File bytes are stored losslessly in blobs, not as UTF-8 JSON strings. Blob names are content-addressed or collision-resistant. The manifest uses canonical workspace-relative paths. `path_key` is the normalized comparison key; on Windows it is lowercased to avoid case-variant duplicates while preserving the original `path` for display and restore.

### 9.3 Path, byte, and file-kind rules

Path safety rules:

- reject absolute paths;
- reject traversal outside the workspace;
- reject symlink escape when the resolved target would leave the workspace;
- reject duplicate `path_key` entries;
- preserve binary and non-UTF-8 bytes through `Buffer` blobs;
- record missing files explicitly.

Preimage capture rules:

- regular file: store exact bytes, hash, size, mtime, and mode where supported;
- missing path: store `kind: "missing"` with no blob;
- directory: store `kind: "directory"` plus mode where supported; recovery only removes a directory if the transaction created it and it is empty, otherwise it blocks or preserves conflict evidence;
- symlink: store link target and mode where supported; if Windows cannot recreate the symlink because of permissions, recovery blocks instead of substituting a file;
- unreadable path: transaction cannot start because there is no recoverable preimage.

The current UTF-8-only snapshot logic in edit/rewind modules must be replaced or wrapped with byte-oriented capture/restore APIs for journaled operations.

### 9.4 Write ordering

A transaction is recoverable before it can mutate.

Edit and rewind must:

1. enumerate every path that may be touched;
2. capture preimage bytes/nonexistence and metadata;
3. write blobs and manifest atomically;
4. validate the manifest can be read back;
5. append and flush payload-free `tx:opened` marker;
6. only then perform the first workspace mutation.

If an operation cannot enumerate all touched paths before mutation, it must journal incrementally before each path mutation, never creating an unrollbackable window.

### 9.5 Commit point and reconciliation

A transaction is committed only after:

1. all intended file/branch mutations complete;
2. final hashes/metadata are captured in `final_state`;
3. journal `state` is atomically updated to `committed` with a new `commit_id`;
4. payload-free `tx:committed` marker is appended and flushed.

The journal `state: "committed"` is the authoritative commit proof. The event marker is the audit proof and can be repaired if the process dies after journal commit but before marker flush. Journal deletion is cleanup, not the authoritative commit proof.

Recovery matrix:

| Journal | Markers | Meaning | Action |
|---|---|---|---|
| missing | success marker present | normal committed transaction | no action |
| missing | no success marker | no open transaction | no action |
| temp files only | any | interrupted atomic write before rename | ignore/delete temp files after report |
| `state: open` | no success marker | interrupted uncommitted transaction | set `aborting`, roll back whole transaction |
| `state: open` | success marker present | inconsistent marker or old bug | block startup; do not roll back or delete evidence |
| `state: aborting` | any | interrupted recovery | resume rollback idempotently |
| `state: committed` | success marker present | committed with leftover journal | verify best-effort, delete journal, report cleanup |
| `state: committed` | success marker missing | committed but marker not flushed | append/flush `tx:committed`, then delete journal, report marker repair |
| corrupt journal | any | unsafe | block startup and report |
| missing undo blob | any uncommitted state | unsafe | block startup and report |

V2-18 does not infer commit from journal age and never blindly deletes stale journals.

## 10. Recovery Reconciler

### 10.1 Startup ordering

A process must:

1. acquire or resolve the project writer lock;
2. run recovery/reconciliation before accepting mutating work or resuming model turns;
3. block normal startup if recovery is unsafe or ambiguous;
4. populate the Recovery Center with found/done/next items;
5. only then enter normal CLI/TUI/GUI operation.

A blocked startup may still show the Recovery Center and allow safe clear/quarantine actions that do not mutate managed workspace files or destroy unresolved evidence.

### 10.2 Transaction recovery policy

Interrupted edit and rewind transactions are always aborted back to pre-operation state. Recovery never auto-finishes a destructive operation. If the user still wants the edit or rewind, they run it again.

For rewind, this means durable journaling must capture both:

- file snapshots needed to restore pre-rewind workspace bytes;
- the full session branch-store state before rewind, including active branch and branch list.

An interrupted rewind is always returned to the pre-rewind state as far as safely possible by restoring file preimages and writing `rewind_branch_state.state_before` back to `rewind_branch_state.branch_store_path`. The user may retry the rewind after recovery completes.

### 10.3 Conflict / unknown-state handling

Before restoring a path, recovery compares current state with known states from the manifest:

- preimage hash and metadata;
- expected transaction-produced hash when available;
- missing/type state;
- symlink target;
- branch metadata state for rewind.

If current state is missing, type-changed, unreadable, permission denied, externally modified, or otherwise unknown, recovery first preserves the current content and metadata under `.deepseek-code/v2/recovered/<txId>/`.

If preserve succeeds, recovery may restore the preimage and report the preserved artifact path. If preserve fails because of disk space, permissions, unreadable content, symlink permissions, or directory conflicts, recovery blocks startup instead of destroying data.

### 10.4 Recovered artifacts

`recovered/<txId>/manifest.json` maps original paths to preserved blobs and metadata:

```json
{
  "schema_version": 1,
  "tx_id": "tx_...",
  "created_at": "2026-06-01T10:42:00.000Z",
  "entries": [
    {
      "path": "src/file.js",
      "path_key": "src/file.js",
      "reason": "external_modified|type_changed|unreadable|permission_denied|directory_conflict|symlink_conflict",
      "kind": "file|directory|symlink|missing",
      "blob": "blobs/abc",
      "hash": "sha256:...",
      "symlink_target": null
    }
  ]
}
```

Recovered artifact writes are idempotent. Repeated recovery attempts must not overwrite existing artifacts; they use stable content-addressed blobs or collision-safe suffixes and preserve earlier manifest entries.

### 10.5 Recovery idempotency

Recovery can itself crash. Therefore:

- set journal `state: aborting` before rollback;
- never delete a journal until rollback/commit reconciliation and reporting complete;
- never overwrite recovered artifacts without preserving prior content;
- tolerate already-restored files;
- rerunning recovery must converge to the same final state or the same blocked state.

## 11. Recovery Center UX and Item Model

V2-18 adds a unified Recovery Center backed by `.deepseek-code/v2/recovery/inbox.json`.

### 11.1 Inbox item model

`inbox.json` stores summaries only:

```json
{
  "schema_version": 1,
  "items": [
    {
      "id": "rec_tx_tx_123",
      "type": "paused_turn|recovered_tx|blocked_recovery|takeover|quarantined_state",
      "status": "pending|done|blocked|cancelled|cleared|quarantined",
      "source_id": "tx_123",
      "created_at": "2026-06-01T10:42:00.000Z",
      "updated_at": "2026-06-01T10:42:00.000Z",
      "summary": "Interrupted edit rolled back",
      "evidence": {
        "sidecar_path": null,
        "journal_path": null,
        "recovered_path": ".deepseek-code/v2/recovered/tx_123/"
      },
      "allowed_actions": ["resume", "cancel", "clear"]
    }
  ]
}
```

Item ids are stable: `rec_pause_<approvalId>`, `rec_tx_<txId>`, `rec_block_<sourceId>`, `rec_takeover_<requestId>`, or `rec_quarantine_<sourceId>`.

`clear` sets `status: "cleared"` and hides a safe reported item from default `/recovery` output. It must not delete unresolved journals, blocked sidecars, recovered artifacts, or evidence needed for later diagnosis. Blocked items can only be cleared after they are explicitly quarantined or otherwise made safe.

### 11.2 Kernel API

Expose stable methods:

```text
kernel.recovery.list({ includeCleared = false } = {})
kernel.recovery.resume(id, { decision } = {})
kernel.recovery.cancel(id)
kernel.recovery.clear(id)
kernel.recovery.report()
```

Return values use `{ status, item, report? }` and throw sanitized errors with `code` for invalid actions. CLI/TUI/GUI must share this model.

Allowed actions:

| Item type/status | resume | cancel | clear |
|---|---:|---:|---:|
| `paused_turn/pending` | yes | yes | no |
| `recovered_tx/done` | no | no | yes |
| `blocked_recovery/blocked` | no | only if action is safe quarantine/clear-unrecoverable | no until safe |
| `takeover/done` | no | no | yes |
| `quarantined_state/quarantined` | no | no | yes |

### 11.3 CLI commands

Add:

```text
/recovery
/recovery resume <id>
/recovery cancel <id>
/recovery clear <id>
```

`/recovery` renders the structured report and current inbox.

`resume` re-enters the existing approval flow and asks the approve/deny question if no decision is supplied.

`cancel` cancels a paused item and deletes or quarantines its sidecar.

`clear` removes a safe, already-reported item from the visible inbox.

### 11.4 GUI/TUI

GUI and TUI must expose the same list/resume/cancel/clear actions through a recovery banner or inspector panel backed by `kernel.recovery.*`. They do not need observer mode or additional GUI-only recovery actions in V2-18.

### 11.5 Structured report

Every startup recovery report follows this shape:

```text
Found:
- interrupted edit tx_123, 3 files touched
- paused approval approval_456

Done:
- rolled back tx_123
- preserved external modification at .deepseek-code/v2/recovered/tx_123/

Next:
- run /recovery resume rec_pause_approval_456
- or /recovery cancel rec_pause_approval_456
```

Reports must summarize sensitive state. They must never print raw resume payloads, prompts, file bytes, diffs, API keys, or undo data.

## 12. Events and Future Hook Points

V2-18 emits stable lifecycle events but does not implement a full external hook platform.

Every event carries `event_id`, `schema_version`, `session_id`, `created_at`, and safe ids. Recovery code that depends on a marker being visible must append directly to the event log or publish and then await `sessionManager.flush()` before proceeding.

| Event | Required payload |
|---|---|
| `recovery:started` | `{ recovery_id, project_id, lock_epoch }` |
| `recovery:blocked` | `{ recovery_id, item_id, source_id, reason, affected_paths_count }` |
| `recovery:report` | `{ recovery_id, found_count, done_count, blocked_count, next_actions }` |
| `tx:opened` | `{ tx_id, kind, original_session_id, path_count, lock_epoch }` |
| `tx:committed` | `{ tx_id, kind, original_session_id, commit_id, path_count }` |
| `tx:recovered` | `{ tx_id, kind, action: "rolled_back", preserved_count, blocked: false }` |
| `turn:paused` | `{ approval_id, turn_id, original_session_id, autonomy, surface }` |
| `turn:rehydrated` | `{ approval_id, turn_id, original_session_id, marker_status }` |
| `turn:resumed` | `{ approval_id, turn_id, original_session_id }` |
| `turn:cancelled` | `{ approval_id, turn_id, original_session_id, reason }` |
| `takeover:requested` | `{ request_id, owner_session_id, requester_surface }` |
| `takeover:completed` | `{ request_id, previous_owner_session_id, new_session_id, forced }` |

Event payloads may contain ids, operation kind, timestamps, counts, safe workspace-relative paths when needed for user action, hashes/status categories, and sanitized error categories.

Event payloads must not contain:

- file contents;
- diffs;
- `resume_state`;
- prompts;
- raw tool input/output payloads forbidden by prior event invariants;
- model reasoning;
- secrets;
- undo data.

Startup marker scans are project-scoped: recovery reads all JSONL logs under `.deepseek-code/v2/sessions/<projectId>/`, skips corrupt/truncated lines using existing event-log tolerance, and correlates markers by `approval_id`, `tx_id`, and `commit_id`.

Later versions can attach real hooks to these events.

## 13. Security and Privacy

`paused/`, `journal/`, and `recovered/` can contain prompts, tool arguments, proprietary source code, secrets, and full file bytes. They are private local recovery state.

Requirements:

1. Add or verify `.gitignore` coverage for `.deepseek-code/` recovery payload paths.
2. Exclude these payloads from telemetry, debug logs, crash reports, export features, and event-log rendering.
3. Use restrictive file permissions where supported by the platform.
4. Redact UI/errors to ids, counts, statuses, sanitized paths, and artifact locations.
5. Delete resolved paused sidecars immediately.
6. Delete committed/reconciled journals after safe cleanup.
7. Retain `recovered/` artifacts until the user explicitly clears/removes them, because they exist to prevent data loss.

## 14. Testing Strategy

Reliability must be tested with deterministic fault injection, not only happy paths.

### 14.1 Fault-injection mechanism

Add a recovery fault-injection dependency that is available only in tests and explicit debug runs:

```js
maybeInjectRecoveryFault("after-journal-write");
```

The helper is a no-op by default. Tests pass an allowlisted fault map through `createKernel({ recoveryFaults })` or set a test-only environment variable that is ignored outside `NODE_ENV === "test"`. Fault labels are stable and live at the exact write boundaries listed below.

Tests must use temporary `projectRoot`, `sessionRoot`, and `.deepseek-code` directories. They must not write recovery artifacts into the real repository `.deepseek-code/v2`.

### 14.2 Unit tests

Paused approval / repair:

- save writes sidecar atomically;
- marker append is flushed before returning durable pause;
- resolve/cancel/interrupt deletes or quarantines sidecar;
- restart scan rehydrates valid sidecars;
- valid sidecar with missing marker is repaired and reported;
- corrupt/orphan/missing sidecars create blocked or quarantined Recovery Center items according to Section 8.3;
- `autonomy`, `surface`, and `permission_context` survive restart;
- repair resume includes required `initial_tool_results`.

Transaction journal:

- journal is durable before first mutation;
- one edit tool call equals one transaction;
- earlier committed transactions remain intact;
- interrupted multi-file transaction rolls back all files in that transaction;
- binary/non-UTF-8 files preserve exact bytes;
- file/directory/symlink/missing restore semantics follow Section 9.3;
- path traversal, duplicate path keys, and symlink escape are rejected;
- journal commit/recovery matrix is followed.

Lock and takeover:

- acquire/release/heartbeat;
- stale lock takeover using TTL/PID rules;
- live takeover request file creation;
- earliest requester wins cooperative takeover;
- owner token/epoch fencing;
- stale owner cannot mutate after epoch change;
- noninteractive fail-closed behavior;
- explicit force takeover;
- two force takeover requesters resolve by read-back ownership verification.

Recovery Center:

- `/recovery` lists paused/recovered/blocked/takeover/quarantined items;
- `/recovery resume <id>` resumes via existing approval path;
- `/recovery cancel <id>` cancels and emits event;
- `/recovery clear <id>` clears only safe reported items;
- GUI/TUI use the same kernel recovery API.

### 14.3 Fault-injection tests

Add test hooks to fail after named boundaries:

- `after-lock-owner-write`;
- `after-takeover-request-write`;
- `during-takeover-release`;
- `after-paused-sidecar-write`;
- `after-turn-paused-marker`;
- `after-journal-write`;
- `after-tx-opened-marker`;
- `after-first-file-write`;
- `after-nth-file-write`;
- `after-branch-created`;
- `after-branch-activated`;
- `after-manifest-committed`;
- `after-tx-committed-marker`;
- `before-journal-delete`;
- `during-rollback`;
- `after-conflict-copy`.

Required scenarios:

1. Crash after journal creation but before mutation -> no-op rollback and report.
2. Crash after each file in a multi-file edit -> whole transaction rolled back, earlier transactions preserved.
3. Crash after journal commit but before `tx:committed` marker -> marker repaired, no rollback.
4. Crash after `tx:committed` marker but before journal deletion -> cleanup only.
5. Crash during rollback -> next boot reruns idempotently.
6. Leftover temp files ignored or cleaned safely.
7. Corrupt/truncated sidecar -> blocked Recovery Center item, no normal sends.
8. Valid sidecar with missing marker -> rehydrate and append repair marker.
9. Corrupt/truncated journal -> recovery blocked, no mutation.
10. External file modification after crash -> preserve current bytes under `v2/recovered/<txId>/`, report, then restore or block if preserve fails.
11. Missing/permission-denied recovered artifact path -> block startup.
12. Cooperative takeover.
13. Force takeover timeout + epoch fencing.
14. Two simultaneous takeover requesters.
15. Windows path/case behavior.
16. Rewind branch-store restore to `state_before` under a fresh current session id.

### 14.4 Full verification

Implementation is not complete until:

```text
npm.cmd test
npm.cmd run check
git diff --check
```

all pass, and tests do not pollute the real `.deepseek-code/v2` project directory.

## 15. Acceptance Criteria

1. If the process dies while waiting for approval, the next launch shows the paused item in Recovery Center and lets the user resume or cancel it.
2. If a turn paused under `supervised`, it resumes under `supervised`, even if the new process default is different.
3. If repair pauses and resumes after restart, repair context including required `initial_tool_results` is preserved.
4. If an edit or rewind crashes mid-operation before journal commit, the next launch rolls back the interrupted transaction and reports Found / Done / Next.
5. If a transaction journal is committed but its event marker is missing, recovery repairs the marker and does not roll back.
6. Earlier committed edit transactions are not rolled back.
7. If a single multi-file edit transaction is interrupted, all files in that transaction are restored to pre-transaction state.
8. External/unknown current bytes are preserved under `.deepseek-code/v2/recovered/<txId>/` before restoration or recovery blocks safely.
9. A second interactive process offers Take over / Cancel.
10. A noninteractive process fails closed unless explicit force takeover is requested.
11. A stale holder cannot continue mutating after lock epoch changes.
12. Recovery blocks normal startup rather than guessing when journal or sidecar state is corrupt or ambiguous; it still exposes safe Recovery Center actions.
13. Event log contains only payload-free lifecycle/audit markers.
14. Recovery UI never prints raw `resume_state`, prompts, diffs, file bytes, or undo data.
15. Recovery Center is available from CLI and exposed to GUI/TUI through the same kernel model.
16. Rewind recovery restores the original session branch store from the journal and reports the action in the current session.
17. All tests/checks pass and no `.deepseek-code/v2` test pollution remains.

## 16. Deferred Work

1. Power-loss durability with fsync/fdatasync and directory fsync.
2. Read-only observer mode for secondary processes.
3. External hook platform attached to recovery lifecycle events.
4. Auto-redo / auto-finish of destructive operations after restart.
5. Rollback of arbitrary shell command side effects.
6. Full Git-like version control or checkpoint browsing.
7. Network/shared workspace concurrency.
8. Cross-machine lock coordination.
9. Retention policy UI for old `recovered/` artifacts beyond manual clear/remove.

## 17. Final Summary

V2-18 turns recovery from an in-process convenience into a process-crash durable product feature.

The design persists paused approval and repair records in private sidecars, preserves original permission/autonomy semantics, journals agent-managed edit and rewind transactions before mutation, rolls back only interrupted uncommitted transactions, prevents simultaneous managed writers through lock ownership checks and takeover fencing, and gives users a real Recovery Center instead of opaque startup messages.

It remains deliberately scoped: no fsync-grade power-loss guarantees, no observer mode, no hook platform, no arbitrary shell rollback, and no Git replacement. The result is a mature local-agent recovery model aligned with the V2 architecture and suitable for 1.0 reliability closure.
