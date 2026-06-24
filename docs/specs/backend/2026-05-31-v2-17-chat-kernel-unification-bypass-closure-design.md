# V2-17 Chat Kernel Unification & Bypass Closure Design

## Objective

Close the last active violations of the V2 "one runtime" invariant and remove
migration dead code, without adding new agent capabilities. The headline change
rebuilds the legacy `chat` command as a thin multi-turn client of the single
kernel runtime, so it gains tools, permissions, the session timeline, and
verification, and removes the direct `chat.js → provider.askDeepSeek` path that
currently bypasses the kernel.

Secondary changes harden the `git` tool's process execution, delete dead
imports, extend the interface-boundary guard, and rewrite the stale README
"Known limitations".

V2-17 is a release-closure / hardening phase. It is explicitly **not** durable
recovery (V2-18) or full legacy deletion / `apps/` relocation (V2-19).

## Current State

- `src/chat.js` (`chatCommand` / `sendChatMessage`) calls `askDeepSeek`
  (`src/provider.js`) directly with no kernel, tools, permissions, session
  timeline, or verification. It is live via the CLI `chat` command
  (`src/cli.js` case `"chat"` → `runChat` → `chatCommand`) and the TUI `chat`
  action (`src/tui.js`). This is a second, untested agent runtime that violates
  the one-runtime invariant and acceptance criterion 9 of the master design.
- The interface-boundary test (`tests/integration/v2-interface-boundary.test.js`)
  only checks that `src/cli.js` has no `askCommand`/`editCommand`/`./agent.js`
  import. It does not guard `chat` or `provider.askDeepSeek`, so the bypass is
  invisible to tests.
- `src/tools/builtin/git.js` `execute()` calls `createShellTool().execute(...)`
  directly. The permission decision is made against git's declared
  `category:"read"` / `side_effect:"none"` / `risk_level:"low"` metadata, while
  the actual subprocess spawn happens inside the shell tool — a nested tool
  execution under the first tool's gate. (Practical exposure is bounded: `argv`
  is `internal:true` and hardcoded to four read-only ops.)
- `src/tui.js:4` still imports `{ askCommand, editCommand }` from `./agent.js`
  but never calls them — a legacy-agent dependency edge in a shipping interface.
- `src/cli.js` `detectTestCommand` (≈ lines 278-312) is dead; the live `test`
  path uses `src/tools/builtin/test.js`.
- README "Known limitations / 已知限制" (README.md ~160-167) is stale: it claims
  approval-resume, verifier-runs-tests, and repair-loop re-entry are unfinished,
  but all three are implemented (V2-7 / V2-8); and it omits the live `chat`
  bypass.
- Autonomy levels (`src/tools/permissions/permission-engine.js`
  `DEFAULT_POLICY_MATRIX`) are `supervised`, `gated`, `auto`, `full-auto`. There
  is no read-only level.

## Reference Precedent

Claude Code and Codex do not have a separate "chat" runtime that bypasses the
agent. Both run one agent loop; conversation is the same loop choosing not to
call tools, and "read-only" is an autonomy/approval mode of that one loop
(Codex `read-only` consultant; Claude Code plan mode), switchable mid-session
(Codex `/permissions`). This design follows that precedent: `chat` is retained
as the interactive multi-turn entry point but becomes a client of the one
kernel, defaulting to read-only and escalating in-session.

## Scope

### In Scope

- Add a `read-only` autonomy level to `DEFAULT_POLICY_MATRIX`.
- Rebuild `chat` as a multi-turn kernel REPL with in-session `/mode`, `/clear`,
  `/history`, `/exit` commands; default autonomy `read-only`.
- Route the CLI `chat` command and the TUI `chat` action to the new kernel chat
  path.
- Remove the single-shot chat path, `chat.js` use of `provider.askDeepSeek`, and
  `.deepseek-code/chat.json` persistence.
- Harden `git`: share one `runProcess` primitive via
  `src/security/shell-policy.js`; git calls it directly with honest metadata; no
  nested tool execution.
- Remove dead code: `src/tui.js:4` legacy import; `src/cli.js`
  `detectTestCommand`.
- Extend `tests/integration/v2-interface-boundary.test.js` to assert no
  interface reaches `provider.askDeepSeek` or the legacy chat path, and that
  `chat` routes through the kernel.
- Rewrite the README "Known limitations" section to match shipped reality.

### Out of Scope

- Durable / crash-safe recovery for approval, repair, or rewind (V2-18).
- Deleting the v1 kernel (`src/kernel/*`), `src/agent.js`, `src/provider.js`, or
  migrating `test/kernel/` (V2-19).
- `apps/` relocation; creating `src/config/` or `src/observability/` (V2-19).
- `git` write operations (add/commit/...) behind approval.
- Making the `task` tool a real sub-agent.
- New GUI work.

## New Autonomy Level: read-only

Add to `DEFAULT_POLICY_MATRIX` (additive; the existing four levels are
unchanged):

```js
"read-only": {
  read: "allow", read_secret: "ask",
  write_create: "deny", write_update: "deny", write_delete: "deny",
  execute: "deny", network: "deny", destructive: "deny"
}
```

Rationale: chat's default must be a predictable "won't touch anything" mode
(Claude Code plan mode / Codex untrusted read-only). `supervised` would *prompt*
for writes rather than refuse them, which is less predictable for a
consultative chat. The new level is also a reusable primitive for safe
exploration elsewhere.

Invariants preserved: `destructive` stays `deny` (already a hardcoded safety
invariant evaluated before the matrix), and `read_secret` stays `ask`.

## Chat Command Redesign

Entry: `dsc chat` (and the TUI chat action) create one long-lived kernel and
enter a multi-turn REPL.

Turn flow:

1. Read a line. If it starts with `/`, dispatch a REPL command; otherwise call
   `kernel.agent.send(line, { autonomy: currentMode })`.
2. Render the event stream and final result via the shared renderer
   (`createEventRenderer`, `renderKernelResult`).
3. If `result.status === "awaiting_approval"`, run the shared approval loop
   (`resolveApprovals`), reusing the existing paused-turn / approve flow.

REPL commands:

- `/mode [read-only|gated|auto]` — with no argument, cycle
  `read-only → gated → auto → read-only`; show the current mode in the prompt.
  Escalation lets chat perform approval-gated edits.
- `/clear` — start a new kernel session (replaces the old chat.json reset).
- `/history` — print the number of turns/events in the current session timeline.
- `/exit` (and `/quit`) — leave the REPL.

Conversation continuity comes from the kernel session, not chat.json. **The
implementation plan must first confirm whether the DeepSeek prompt assembler
threads prior-turn messages across separate `agent.send` calls.** If it does
not, threading the running conversation into the chat send path is an in-scope
task for this phase, because chat is multi-turn by definition.

Shared helper extraction: extract the approval loop currently inline in
`runKernelAgentCommand` (`src/apps/cli/kernel-runner.js`) into a shared
`resolveApprovals(...)` used by both `ask` and `chat`.

Removals:

- `chat.js` single-shot branch (`if (prompt) ...`) and the `sendChatMessage`
  direct `askDeepSeek` call.
- `.deepseek-code/chat.json` load/save
  (`loadChatHistory` / `saveChatHistory` / `clearChatHistory`).
- `src/chat.js` is reduced to a thin launcher of the kernel REPL or removed from
  the CLI/TUI import path entirely. The plan picks the minimal shape; the
  invariant is that no interface reaches `provider.askDeepSeek`.

## Git Tool Hardening

- Move `runProcess` from `src/tools/builtin/shell.js` to
  `src/security/shell-policy.js`. Both the shell tool and the git tool import it
  from there (one gated process primitive).
- `git.js` `execute()` resolves cwd via `resolveWorkspacePath` and calls
  `runProcess(argv, { cwd })` directly; it no longer constructs or calls the
  shell tool.
- Metadata honesty: `side_effect: "none" → "process"`. `category` stays `"read"`
  (the four ops are genuine reads; this keeps git read-allowed without approval,
  matching the master design's "git read ops allowed, writes require approval").
- No behavior change for `status` / `diff` / `log` / `show`.

## Dead Code Removal

- Remove `import { askCommand, editCommand } from "./agent.js"` at
  `src/tui.js:4` (unused).
- Remove `detectTestCommand` from `src/cli.js` (dead; the live path is
  `src/tools/builtin/test.js`). Confirm no remaining caller before removal.

## Interface Boundary Test

Extend `tests/integration/v2-interface-boundary.test.js`:

- Assert `src/cli.js` and `src/tui.js` source contains no `provider` /
  `askDeepSeek` reference and no `./agent.js` import.
- Assert the `chat` command path constructs a kernel (routes through
  `createKernel`) rather than calling the legacy `chatCommand` model path.

## README Update

Rewrite the "Known limitations / 已知限制" section to reflect reality:

- Remove the false claims that approval-resume, verifier-runs-tests, and
  repair-loop re-entry are unimplemented.
- State the accurate remaining limitations: in-process (non-crash-durable)
  recovery for approval/repair/rewind, single-round repair executor, no
  cross-process locks, retained v1 legacy modules pending V2-19, and the GUI
  offline usage fallback showing zeros.
- Note that `chat` now runs on the kernel in read-only mode by default and
  escalates with `/mode`.

## File Boundaries

Primary:

- `src/tools/permissions/permission-engine.js` — add the read-only level.
- `src/security/shell-policy.js` — host `runProcess`.
- `src/tools/builtin/shell.js` — import `runProcess` from shell-policy.
- `src/tools/builtin/git.js` — use the shared `runProcess`, honest metadata.
- `src/apps/cli/kernel-runner.js` — extract `resolveApprovals`; add the chat
  REPL (here or in a new `src/apps/cli/chat-repl.js`).
- `src/cli.js` — `chat` routes to the kernel REPL; remove `detectTestCommand`.
- `src/tui.js` — chat action routes to the kernel REPL; remove the legacy import.
- `src/chat.js` — remove the legacy provider path; reduce to a wrapper or drop
  from the active path.
- `README.md` — known-limitations rewrite.

Tests:

- `tests/unit/tools/permission-engine.test.js` — read-only matrix row across all
  8 categories.
- `tests/unit/tools/builtin-process.test.js` — git uses `runProcess`, four read
  ops still work, no nested tool execution.
- `tests/unit/apps/cli/` — chat REPL command dispatch, multi-turn send, and
  `/mode` escalation.
- `tests/integration/v2-interface-boundary.test.js` — extended guards.

## Verification

Automated:

- `npm.cmd test` (full suite green; existing 505 plus new tests).
- `npm.cmd run check`.
- `git diff --check`.

Manual:

- `dsc chat` answers a question in read-only mode without touching files.
- `/mode` escalates; an edit request then prompts for approval and applies with
  a change id and rollback path.

Pollution checks:

- Tests use temp project roots.
- No test creates `.deepseek-code/v2` or `.deepseek-code/chat.json` in the repo
  root.

## Risks

- **Multi-turn continuity:** if the prompt assembler does not thread prior
  turns, chat would feel stateless. Mitigated by making history-threading an
  in-scope task gated on the plan's confirmation, with a two-turn memory test.
- **chat.json removal** is a small behavior change for existing users;
  acceptable for 1.0 and documented in the README.
- **Autonomy matrix change** touches a security-core table; mitigated by an
  additive-only change, the full 8-category test, and the unchanged
  `destructive: deny` invariant.
- **chat.js reduction** must not break other legacy commands; `askDeepSeek`
  stays in `provider.js` for `agent.js` until V2-19.
