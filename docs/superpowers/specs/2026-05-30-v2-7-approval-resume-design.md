# V2-7 Approval Resume Design

> Status: design approved for implementation plan  
> Date: 2026-05-30  
> Scope: in-memory approval resume for the V2 runtime, CLI, TUI, and GUI

## 1. Purpose

V2 can already ask for approval, but approval is currently a terminal pause. `agent.send()` returns `awaiting_approval`, and `agent.approve()` only publishes `approval:resolved`; it does not continue the original tool loop.

V2-7 closes that interactive control-flow gap:

```text
model requests tool
 -> permission engine returns ask
 -> approval:requested event is published
 -> runtime stores the paused turn
 -> user approves or denies
 -> runtime resumes or cancels the same turn
 -> tool result feeds back to the model
 -> final answer is published
```

This phase makes approval cards useful in GUI/TUI/CLI without attempting durable cross-process resume.

## 2. Goals

1. Resume the same in-memory turn after a user approval.
2. Preserve the single ToolExecutor path: approval must not bypass schema validation, permission checks, execution, redaction, or tool events.
3. Support both approve and deny decisions.
4. Keep repeated approval calls safe and deterministic.
5. Keep interruption safe: interrupt clears active and paused state.
6. Update CLI, TUI, and GUI so approval controls continue the pending turn.
7. Persist `approval:requested`, `approval:resolved`, `tool:result`, and `agent:final` through the existing V2 session manager.
8. Maintain all existing V2-0 through V2-6 tests.

## 3. Non-Goals

- No resume after process restart.
- No multi-turn or multi-approval queue.
- No durable paused-state serialization.
- No full repair loop.
- No context engine work.
- No usage stats or observability work.
- No broad rewrite of TUI/README mojibake unless required by approval controls.

## 4. Current Behavior

The current runtime path:

```text
createAgentRuntime.send()
 -> runExecutorLoop()
 -> executeTool()
 -> ToolExecutor returns ToolResult(status: "approval_required")
 -> runExecutorLoop returns { status: "awaiting_approval", approval }
 -> send() returns awaiting_approval and releases currentTurnId
```

The current approve path:

```js
function approve(approvalId, decision) {
  publish(eventBus, "approval:resolved", { approval_id: approvalId, decision });
}
```

There is no stored paused state. The executor loop loses its messages, pending tool call, iteration count, and accumulated tool results when it returns.

## 5. Chosen Approach

Use an in-memory paused turn store plus approval-cache based resume.

When a tool returns `approval_required`, executor loop returns a resumable snapshot:

```js
{
  status: "awaiting_approval",
  approval,
  resume_state: {
    turn_id,
    message,
    classification,
    messages,
    model_result,
    raw_tool_calls,
    pending_tool_call,
    remaining_tool_calls,
    iteration,
    tool_results,
    tool_schemas,
    max_iterations,
    options
  }
}
```

Runtime stores this under `approval.id`. On approve:

1. Runtime takes the paused record from `PausedTurnStore`.
2. Runtime publishes `approval:resolved`.
3. Runtime grants the matching fingerprint into `approvalCache`.
4. Runtime calls `resumeExecutorLoop(resume_state, dependencies)`.
5. ToolExecutor runs normally. Permission now returns allow from approval cache.
6. Runtime continues verification and finalization.

On deny:

1. Runtime takes the paused record.
2. Runtime publishes `approval:resolved`.
3. Runtime publishes `agent:final` with a cancelled/denied message.
4. Runtime returns `{ status: "cancelled", state: "idle" }`.

## 6. New Module: `paused-turn-store`

File:

```text
src/core/approval/paused-turn-store.js
```

Responsibilities:

- Save a paused approval record.
- Get a paused record by approval id.
- Take a paused record exactly once.
- Delete all records for a turn.
- Clear all records.
- Reject duplicate approval ids.

Public API:

```js
createPausedTurnStore() -> {
  save(record),
  get(approvalId),
  take(approvalId),
  deleteForTurn(turnId),
  clear(),
  size()
}
```

Record shape:

```js
{
  approval_id,
  turn_id,
  approval,
  turn,
  resume_state,
  created_at
}
```

The store is intentionally in-memory. This keeps V2-7 small and avoids serializing model messages or tool call state into session logs before the session replay design exists.

## 7. Executor Loop Changes

`runExecutorLoop()` keeps its current role but returns `resume_state` when it pauses.

`resumeExecutorLoop()` is added:

```js
resumeExecutorLoop({
  resumeState,
  modelGateway,
  executeTool,
  createPolicyContext,
  eventBus,
  signal
}) -> LoopResult
```

Resume algorithm:

1. Execute `pending_tool_call`.
2. If it still returns `approval_required`, stop again with a new `resume_state`.
3. Execute each `remaining_tool_call` in order.
4. Append assistant tool-call message and tool result messages.
5. Continue model calls until final answer or `maxIterations`.

Important invariant:

`resumeExecutorLoop()` must not directly call tool implementations. It must call `executeTool()` so all existing security and audit behavior remains intact.

## 8. Approval Cache Grant

The cleanest way to resume without bypassing security is to let permission re-evaluate and pass through `approvalCache`.

The runtime needs a dependency:

```js
grantApprovalForToolCall(toolCall, policyInput)
```

`src/index.js` implements it using existing components:

```js
const policyContext = createPolicyContext(...)
const securedCall = toolRegistry.secureToolCall(toolCall)
const fp = permissionEngine.fingerprint(securedCall, policyContext)
approvalCache.grant(fp, { decision: "allow" })
```

To support this without duplicating executor internals, `ToolRegistry` should expose a safe helper:

```js
secureToolCall(toolCall) -> {
  id,
  name,
  params,
  category,
  risk_level,
  side_effect,
  requested_by_step_id
}
```

`ToolExecutor` should use the same helper internally. That keeps category derivation consistent.

## 9. Runtime Changes

`createAgentRuntime()` receives new dependencies:

```js
pausedTurnStore = createPausedTurnStore()
grantApprovalForToolCall = null
```

`send()` behavior:

- If executor loop pauses, runtime saves the paused record before returning.
- Runtime state becomes `awaiting_approval`.
- `currentTurnId` is released so the UI can call `approve()` without BUSY.
- Starting a new `send()` while a paused turn exists should fail with a clear `AWAITING_APPROVAL` error. This avoids confusing two active control flows.

`approve(approvalId, decision)` behavior:

- `approve` becomes async.
- Unknown approval id returns or throws a clear error.
- `"approve"` and `"allow"` are accepted as allow decisions.
- `"deny"` and `"reject"` are accepted as deny decisions.
- Duplicate approval fails because `take()` removes the record.
- During resume, runtime sets lifecycle to `execute`.
- On final completion, runtime publishes `agent:final`.
- On denial, runtime publishes `agent:final` with status `cancelled`.

`interrupt()` behavior:

- Clears active abort controller.
- Clears paused records.
- Publishes no stale final events.

## 10. Kernel API and UI Changes

Public Kernel API remains stable:

```js
kernel.agent.approve(approvalId, decision) -> Promise<Result>
```

GUI:

- `gui/kernel-host.js` changes `approve()` to async and returns `{ ok: true }` after scheduling/resolving runtime approval.
- Approval final results continue to arrive through `kernel:event`.
- Renderer can keep calling `window.deepseek.approve(id, "allow" | "deny")`.

CLI:

- `runKernelAgentCommand()` handles `awaiting_approval` by prompting in-process.
- On `y`/`yes`/`approve`, call `kernel.agent.approve(approval.id, "approve")`.
- On anything else, call `kernel.agent.approve(approval.id, "deny")`.
- Tests inject a prompt function so CLI approval can be tested without TTY.

TUI:

- `sendKernelPrompt()` handles `awaiting_approval` with a minimal prompt.
- If user approves, call `kernel.agent.approve()`.
- If user denies, return a cancelled message.
- Full multi-panel approval UI remains out of scope.

## 11. Error Handling

Required error cases:

- Unknown approval id: `APPROVAL_NOT_FOUND`.
- Duplicate approval: same as unknown after first take.
- Approval while another turn is executing: `BUSY`.
- New send while paused approval exists: `AWAITING_APPROVAL`.
- Denied approval: deterministic cancelled result, not thrown.
- Resume tool asks for approval again: store the new approval and return `awaiting_approval`.

## 12. Tests

Unit tests:

- PausedTurnStore save/get/take/delete/duplicate.
- Executor loop returns resume_state on approval.
- Resume executor loop executes pending tool after approval.
- Resume handles remaining tool calls in order.
- Runtime approve publishes `approval:resolved` and completes.
- Runtime deny cancels without tool execution.
- Runtime rejects duplicate approvals.
- Runtime rejects new send while paused.
- Interrupt clears paused approvals.

Integration tests:

- `createKernel()` supervised edit pauses, approve applies file, verifier runs, final event publishes.
- Deny leaves file unchanged and publishes cancelled final.
- GUI host approve delegates async and emits final once.
- CLI runner prompts approval and resumes in-process.

Regression tests:

- Query fast path remains unchanged.
- `approval_required` still returns without writing before approval.
- Session timeline records requested/resolved/tool/final events.
- No tests create `.deepseek-code/v2` in the repository root.

## 13. Acceptance Criteria

V2-7 is accepted when:

1. `kernel.agent.send(edit, { autonomy: "supervised" })` returns `awaiting_approval` and does not write.
2. `kernel.agent.approve(approval.id, "approve")` resumes the same turn and writes through the original tool.
3. `kernel.agent.approve(approval.id, "deny")` leaves files unchanged and returns cancelled.
4. Approval resume emits `approval:resolved`, `tool:result`, optional `verification:result`, and `agent:final`.
5. Duplicate approval is rejected.
6. New `send()` while a paused approval exists is rejected with `AWAITING_APPROVAL`.
7. `interrupt()` clears paused approvals.
8. CLI can approve once in-process and print the final result.
9. GUI host approval no longer only publishes an event; it resumes runtime.
10. Full test, syntax check, and whitespace check pass.

## 14. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Resume bypasses permission checks | Use approval cache and call ToolExecutor again |
| Paused state grows too complex | Keep V2-7 to one active paused turn; no durable resume |
| Duplicate approval causes double writes | `take()` removes record before execution |
| New send interleaves with paused turn | Reject new send while paused approvals exist |
| Interrupt races with resume | Use existing generation/abort checks and clear paused store |
| CLI prompt blocks tests | Inject prompt function in CLI runner |

## 15. Future Work

After V2-7:

- Durable approval resume through session replay.
- Multi-approval queues.
- Rich diff preview in GUI approval card.
- Context engine with cache-aware prompt assembly.
- Usage/observability surfaced in GUI/TUI.
