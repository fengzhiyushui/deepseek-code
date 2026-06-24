# V2-8 Verifier & Repair Loop Design

> Status: design approved for implementation plan
> Date: 2026-05-31
> Scope: V2 runtime verification policy and bounded automatic repair loop

## 1. Purpose

V2 can execute tool calls, apply edits, and run a lightweight verifier. The current verifier is only a gate: when verification fails, `agent-runtime.js` throws `verification failed` and ends the turn. This leaves the agent unable to use DeepSeek's repair channel to fix its own edits.

V2-8 changes verification from a terminal gate into a bounded repair loop:

```text
edit tools run
 -> verifier runs
 -> passed: final response
 -> failed/error: ask DeepSeek repair channel for corrective tool calls
 -> execute repair tools through ToolExecutor
 -> verify again
 -> repeat up to maxRepairAttempts
```

The loop must preserve all V2 security invariants. Repair is not a privileged execution mode; it is another model-guided tool loop that still uses `ToolExecutor`, `PermissionEngine`, approval resume, workspace safety, redaction, and session events.

## 2. Goals

1. Add a verification policy that can choose detect-only verification or actual test execution.
2. Add a bounded repair loop after failed verification.
3. Use DeepSeek's `repair` purpose/profile for repair planning.
4. Keep all repair tool calls on the existing ToolExecutor path.
5. Preserve approval pause/resume during repair.
6. Emit repair events to the V2 session timeline.
7. Avoid exposing `reasoning_content` in repair prompts, events, or tool results.
8. Keep query fast path unchanged.
9. Maintain all V2-0 through V2-7 tests.

## 3. Non-Goals

- No context engine implementation.
- No GUI repair visualization beyond existing event rendering.
- No TUI redesign.
- No durable repair state after process restart.
- No long-term repair memory.
- No transaction rollback for partial diff application.
- No automatic destructive action.
- No direct shell string execution.
- No hidden bypass around approval or permission policy.

## 4. Current Behavior

The current runtime path after a tool loop:

```text
runExecutorLoop()
 -> runVerifier()
 -> decideRepair()
 -> passed/skipped: complete
 -> approval_required: return awaiting_approval
 -> failed/error: throw Error("verification failed: ...")
```

`runVerifier()` currently creates a `test` tool call with:

```js
params: { detect: true }
```

The test tool in detect mode reports the detected test command without running it. This is useful for low-risk smoke verification, but it cannot catch most real regressions. V2-8 must keep detect-only available while adding a controlled path for actual test execution.

## 5. Chosen Approach

Use a verification policy plus bounded repair loop.

The runtime gets two new dependencies:

```js
createVerificationPolicy(options) -> VerificationPolicy
runRepairLoop(input) -> RepairLoopResult
```

High-level flow:

```text
runToolLoopPath()
 -> runExecutorLoop()
 -> verifyAndMaybeRepair()
    -> runVerifier(policy)
    -> passed/skipped: return complete result
    -> approval_required: return awaiting_approval
    -> failed/error: runRepairLoop()
       -> DeepSeek repair invoke
       -> adapt tool calls
       -> execute tools
       -> runVerifier(policy)
       -> repeat or stop
```

The repair loop returns the same status vocabulary used by the runtime:

```js
{
  status: "complete" | "failed" | "awaiting_approval",
  content,
  toolResults,
  verification,
  repair,
  approval,
  resume_state
}
```

## 6. Verification Policy

New file:

```text
src/core/verification/verification-policy.js
```

Responsibilities:

- Normalize verification options.
- Decide whether the `test` tool should detect only or actually run.
- Keep default behavior conservative.
- Make test execution explicit and easy to test.

Policy input:

```js
{
  autonomy,
  verifyMode,
  explicitTestArgv,
  hasEditResults
}
```

Supported modes:

```text
detect   -> always call test with { detect: true }
run      -> call test with { detect: false } or explicit argv
auto     -> run for gated/auto/full-auto, detect for supervised
off      -> skip verification
```

Default:

```text
verifyMode: "auto"
```

Policy output:

```js
{
  shouldVerify: true,
  testParams: { detect: true }
}
```

or:

```js
{
  shouldVerify: false,
  reason: "verification disabled"
}
```

The policy must never produce a raw shell command string. When explicit argv is provided, it must be an array of strings and is passed to the existing `test` tool schema.

## 7. Verifier Changes

Modify:

```text
src/core/verification/verifier.js
```

`runVerifier()` accepts:

```js
{
  turnId,
  toolResults,
  executeTool,
  createPolicyContext,
  verificationPolicy,
  eventBus
}
```

Behavior:

1. If there are no successful edit-like tool results, publish `verification:result` with `skipped`.
2. Ask `verificationPolicy` for test params.
3. If policy says `shouldVerify: false`, publish `skipped`.
4. Execute the `test` tool through `executeTool()`.
5. Map result:
   - `status: "success"` and `metadata.exit_code` absent or `0` -> `passed`
   - `status: "success"` and non-zero `metadata.exit_code` -> `failed`
   - `status: "approval_required"` -> `approval_required`
   - `status: "denied"` -> `failed`
   - `status: "error"` -> `error`
6. Publish `verification:result`.

This fixes an existing ambiguity: the shell/test tool can return `status: "success"` while carrying a non-zero exit code in metadata. V2-8 treats that as verification failure.

## 8. Repair Prompt and Model Call

New file:

```text
src/core/verification/repair-prompt.js
```

Responsibilities:

- Build a compact repair prompt for DeepSeek.
- Include only user-safe summaries.
- Avoid raw reasoning content.
- Avoid dumping huge raw tool output.

Repair prompt inputs:

```js
{
  userMessage,
  classification,
  verification,
  toolResults,
  previousRepairAttempts,
  maxRepairAttempts
}
```

The prompt tells DeepSeek:

- The previous edit failed verification.
- Use available tools to make the smallest corrective change.
- Prefer `read`, `grep`, `glob`, and `edit`.
- Do not ask the user unless blocked.
- Return normal tool calls when changes are needed.
- Return final content with no tool calls if no repair is possible.

The model call uses:

```js
modelGateway.invoke(messages, {
  purpose: "repair",
  tools,
  toolChoice: "auto",
  signal
})
```

## 9. Repair Loop

New file:

```text
src/core/verification/repair-loop.js
```

Responsibilities:

- Run at most `maxRepairAttempts`.
- Publish repair events.
- Invoke DeepSeek repair channel.
- Execute repair tool calls through the existing executor loop machinery.
- Re-run verifier after each repair attempt.
- Return `awaiting_approval` if repair tool execution needs approval.
- Return `failed` if attempts are exhausted.

Public API:

```js
runRepairLoop({
  turnId,
  userMessage,
  classification,
  modelGateway,
  toolSchemas,
  executeTool,
  createPolicyContext,
  verificationPolicy,
  initialVerification,
  initialToolResults,
  eventBus,
  signal,
  maxRepairAttempts,
  options
}) -> RepairLoopResult
```

Repair event sequence:

```text
repair:started
repair:attempt
model:request
model:response
tool:call / permission:decision / tool:result
verification:result
repair:result
repair:exhausted
```

`repair:result` includes:

```js
{
  turn_id,
  attempt,
  status,
  verification_status,
  tool_result_count
}
```

It must not include raw diffs, raw stdout beyond existing redacted tool results, API keys, or `reasoning_content`.

## 10. Repair Executor

New file:

```text
src/core/execution/repair-executor.js
```

Repair execution should reuse the existing execution helpers rather than introducing a second tool pathway.

Responsibilities:

- Call `modelGateway.invoke()` with `purpose: "repair"`.
- Convert DeepSeek tool calls through `adaptDeepSeekToolCalls()`.
- Execute repair tools through injected `executeTool()`.
- Convert repair tool results into tool messages through `toolResultsToMessages()`.
- Return `awaiting_approval` with a V2-7 compatible `resume_state` when any repair tool needs approval.
- Return `complete` when the repair model gives a final response or after repair tool results have been fed back once.

Public API:

```js
runRepairExecutor({
  turnId,
  messages,
  modelGateway,
  toolSchemas,
  executeTool,
  createPolicyContext,
  eventBus,
  signal,
  options
}) -> RepairExecutorResult
```

Important invariant:

`runRepairExecutor()` must not call tool definitions directly. It must call `executeTool()` so schema validation, permissions, approval, redaction, and audit events are identical to normal execution.

Repair execution may produce:

```js
{ status: "complete", content, toolResults }
{ status: "awaiting_approval", approval, resume_state, toolResults }
```

If approval is required during repair, the `resume_state` uses the same shape as V2-7 `resumeExecutorLoop()`. After the user approves, `agent-runtime.approve()` resumes that tool loop through `resumeExecutorLoop()`, then calls `verifyAndMaybeRepair()` again. This keeps approval resume in one place and avoids a second paused-state format.

## 11. Runtime Integration

Modify:

```text
src/core/runtime/agent-runtime.js
```

Current duplicated verification blocks in `send()` and `approve()` should be extracted into a helper:

```js
verifyAndMaybeRepair({
  turn,
  message,
  classification,
  loop,
  options,
  signal
})
```

This helper:

1. Runs verifier with policy.
2. Returns complete result if verification passes or skips.
3. Returns awaiting approval if verification or repair asks.
4. Runs repair loop if verification fails and repair attempts remain.
5. Throws or returns failed after attempts are exhausted according to existing runtime error conventions.

Lifecycle transitions:

```text
execute -> verify -> repair -> verify -> complete
execute -> verify -> repair -> awaiting_approval
execute -> verify -> failed
```

The query fast path remains untouched.

## 12. Kernel Integration

Modify:

```text
src/index.js
```

Kernel options:

```js
{
  verifyMode: "auto" | "detect" | "run" | "off",
  testArgv: ["npm", "test"],
  maxRepairAttempts: 2
}
```

Defaults:

```js
verifyMode: "auto"
maxRepairAttempts: 2
```

The kernel passes these options into `createAgentRuntime()`.

## 13. Session Event Types

Modify:

```text
src/sessions/event-types.js
```

Add:

```text
repair:started
repair:attempt
repair:result
repair:exhausted
```

Existing session manager behavior should persist these events automatically after registration.

## 14. Error Handling

Repair loop errors are handled by category:

- Model API error: publish `repair:result` with `status: "error"` and return/throw failed.
- Malformed tool calls: route through existing tool-call adapter errors; publish `agent:error` through runtime.
- Permission ask: return `awaiting_approval`.
- Permission deny: treat as failed repair attempt.
- Verification approval_required: return `awaiting_approval`.
- Max attempts exhausted: publish `repair:exhausted` and fail the turn.

The runtime must clear `currentTurnId` and abort controller on terminal failure exactly as it does today.

## 15. Testing Strategy

Unit tests:

- `verification-policy.test.js`
  - default auto policy detects in supervised mode
  - auto policy runs in gated mode
  - explicit argv must be array of strings
  - off mode skips verification
- `verifier.test.js`
  - non-zero exit code maps to `failed`
  - detect-only success maps to `passed`
  - no edit results skips
  - approval_required is preserved
- `repair-prompt.test.js`
  - prompt excludes `reasoning_content`
  - prompt truncates long output
  - prompt includes verification reason
- `repair-loop.test.js`
  - failed verification triggers repair attempt
  - repair tools execute through injected `executeTool`
  - max attempts emits exhausted
  - approval_required stops repair

Integration tests:

- `v2-repair-loop.test.js`
  - edit fails verification, repair edit applies, second verification passes, final status complete
  - repair requiring approval returns awaiting_approval and does not bypass permission
  - query task does not enter repair loop
  - session timeline includes verification and repair events

Regression tests:

- Existing V2-7 approval resume tests still pass.
- Existing CLI/TUI/GUI boundary tests still pass.
- Full `npm.cmd test`, `npm.cmd run check`, `git diff --check` pass.
- Tests must not create `.deepseek-code/v2` under the repository root.

## 16. Acceptance Criteria

V2-8 is complete when:

1. A failed post-edit verification can trigger at least one repair attempt.
2. A successful repair can produce final `status: "complete"`.
3. Repair tool calls go through ToolExecutor and publish normal tool events.
4. Repair can stop at approval without writing unauthorized changes.
5. Max repair attempts are enforced.
6. Non-zero test exit codes are treated as verification failure.
7. Query fast path remains unchanged.
8. Repair events are persisted in session timeline.
9. No raw `reasoning_content` appears in repair prompts or events.
10. Full regression passes with no repository session pollution.

## 17. Deferred Work

- V2-9 Context Engine for better repair prompts.
- Transactional edit apply and automatic rollback on failed repair.
- Durable repair resume after process restart.
- GUI repair timeline cards.
- Rich test selection across npm, pytest, cargo, go, and project-specific commands.
- Long-term repair memory.
