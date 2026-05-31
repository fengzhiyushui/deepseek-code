# V2-9 Context Engine Design

> Status: design approved for implementation plan
> Date: 2026-05-31
> Scope: minimum usable V2 context engine with DeepSeek cache-aware interfaces

## 1. Purpose

V2 can now run a real agent loop: DeepSeek can call tools, tools can edit files, verification can run, approvals can resume, and failed verification can enter a repair loop. The remaining gap is that V2 still sends little project context before the first model call. `kernel.context.snapshot()` currently returns:

```js
{ snapshot_id: "v2_empty_snapshot", units: [], budget: { allocated: 0, used: 0 } }
```

That makes the agent behave like a tool-only explorer. It can eventually inspect files, but the first planning call is blind, repair prompts are thinner than they should be, and DeepSeek cannot benefit from a stable cache-friendly project prefix.

V2-9 adds the first real V2 context engine. The goal is not a full semantic index. The goal is a safe, deterministic, budgeted project context snapshot that can be passed into `prompt-assembler` and used by ask/edit/repair flows.

## 2. Goals

1. Replace the empty V2 context facade with a real context engine.
2. Scan workspace files safely using V2 workspace safety rules.
3. Produce deterministic `ContextUnit` records with path, hash, size, token estimate, priority, and snippet.
4. Select a budgeted context snapshot for query/edit/diagnostic/general tasks.
5. Support pinned files and message-mentioned files as hot context.
6. Build a compact `summary` string that `deepseek/prompt-assembler.js` can inject into the system prompt.
7. Preserve DeepSeek cache-aware ordering by putting stable project prefix units first.
8. Publish and persist safe context events.
9. Maintain all V2-0 through V2-8 tests.

## 3. Non-Goals

- No embeddings or vector database.
- No AST parser.
- No import graph.
- No language-server integration.
- No shell execution from context modules.
- No GUI redesign.
- No durable context cache on disk.
- No automatic large-file summarization through a model.
- No legacy V1 context-engine migration as-is.

## 4. Current Behavior

`src/index.js` exposes:

```js
const context = {
  async snapshot() {
    return { snapshot_id: "v2_empty_snapshot", root, units: [], budget: { allocated: 0, used: 0 } };
  },
  pin(p) { eventBus.publish("context:pin", { path: p }); },
  unpin(p) { eventBus.publish("context:unpin", { path: p }); }
};
```

`runExecutorLoop()` already accepts a `context` parameter and passes it to:

```js
assembleReplyMessages({ message, classification, context, systemAddendum })
```

`prompt-assembler.js` already knows how to include:

```js
context?.summary
```

So the missing pieces are:

```text
createContextEngine(root)
 -> scan/index workspace
 -> snapshot(message, classification, channel)
 -> kernel passes snapshot into runtime/executor loop
 -> prompt assembler includes snapshot.summary
```

## 5. Chosen Approach

Build a focused `src/context/` V2 service instead of importing `src/kernel/context-engine.js` directly.

The V1 engine has useful ideas: priority tiers, budgets, pinned files, cache prefix hints. But it lives under old `src/kernel/`, has V1-shaped snapshot output, and duplicates workspace safety. V2-9 should reuse the concepts, not the file.

New module layout:

```text
src/context/
+-- context-unit.js
+-- workspace-indexer.js
+-- token-budget.js
+-- context-selector.js
+-- context-snapshot.js
`-- index.js
```

High-level flow:

```text
createKernel(root)
 -> createContextEngine({ root, eventBus })
 -> await contextEngine.scan()

agent.send(message, options)
 -> classifyMessage(message)
 -> contextEngine.snapshot({ message, classification, channel: "think" | "act" })
 -> runExecutorLoop(..., context: snapshot)
 -> assembleReplyMessages() includes snapshot.summary
```

## 6. Context Unit Model

File:

```text
src/context/context-unit.js
```

`ContextUnit` is a small metadata record plus a bounded snippet:

```js
{
  id: "ctx_abcd1234",
  type: "file",
  path: "src/index.js",
  hash: "sha256:...",
  bytes: 1234,
  token_count: 353,
  priority: 0,
  reason: "project-manifest",
  snippet: "...",
  updated_at: "2026-05-31T..."
}
```

Priorities:

```text
P0 stable prefix: package.json, README.md, pyproject.toml, Cargo.toml, go.mod, environment.yml
P1 hot: pinned files and files mentioned by the user message
P2 warm: tests, source entrypoints, config files, and files explicitly warmed through the context API
P3 cold: indexed metadata only unless selected by rule
```

The `id` and `hash` must be deterministic for the same path/content. Snapshot IDs can be unique per snapshot.

## 7. Workspace Indexer

File:

```text
src/context/workspace-indexer.js
```

Responsibilities:

- Walk the workspace using `walkWorkspaceFiles()` from `src/workspace/path-safety.js`.
- Reuse `readWorkspaceTextFile()` for path safety, binary rejection, and max-byte protection.
- Ignore known heavy or generated directories:

```text
.git
.deepseek-code
node_modules
dist
build
coverage
.next
.nuxt
.turbo
.cache
target
vendor
__pycache__
gui/node_modules
```

- Limit scan work with defaults:

```js
maxFiles: 1000
maxFileBytes: 64 * 1024
maxSnippetBytes: 4000
```

The indexer returns a map:

```js
Map<relativePath, ContextUnit>
```

Unreadable, binary, or oversized files are skipped and counted in stats. They are not fatal.

## 8. Token Budget

File:

```text
src/context/token-budget.js
```

Responsibilities:

- Estimate tokens cheaply with byte length.
- Normalize channel budgets.
- Select units without exceeding budget.

Defaults:

```js
think: 12000
act: 8000
repair: 10000
reply: 6000
```

These are intentionally smaller than DeepSeek's maximum context. V2-9 should be reliable and cheap first. V2-10 can expand budgets using cache metrics and model profile limits.

## 9. Context Selector

File:

```text
src/context/context-selector.js
```

Responsibilities:

- Rank units for a snapshot.
- Always consider P0 stable prefix first.
- Promote pinned files to P1.
- Promote files explicitly mentioned in the user message to P1.
- Promote likely test/config companions to P2 for edit and repair tasks.
- Produce selection reasons.

Mention detection is deterministic and simple:

- Exact relative path match.
- Basename match when unique in the index.
- Quoted path fragments like `src/index.js`, `README.md`, `package.json`.

No fuzzy search in V2-9.

## 10. Context Snapshot

File:

```text
src/context/context-snapshot.js
```

Snapshot shape:

```js
{
  snapshot_id,
  root,
  channel,
  task_type,
  summary,
  units: [
    {
      id,
      path,
      hash,
      token_count,
      priority,
      reason
    }
  ],
  unit_hashes,
  file_revision_hashes,
  assembly_order,
  expected_cache_prefix_offset,
  budget: {
    allocated,
    used,
    remaining
  },
  stats: {
    indexed_files,
    skipped_files,
    selected_files
  }
}
```

`summary` is the only field sent to the model by V2-9:

```text
Project files:
- package.json (P0 project-manifest)
- README.md (P0 project-doc)
- src/index.js (P1 mentioned)

Relevant snippets:
--- package.json
...
--- README.md
...
```

The stable prefix order is deterministic:

```text
P0 by priority list
P1 pinned/mentioned by path
P2 warm by path
P3 selected by path
```

`expected_cache_prefix_offset` is the estimated token count of the stable P0 portion. It is a hint, not a guarantee.

## 11. Context Engine API

File:

```text
src/context/index.js
```

Public API:

```js
createContextEngine({ root, eventBus, options }) -> {
  scan(),
  snapshot(input),
  pin(path),
  unpin(path),
  warm(path, reason),
  invalidate(path),
  getStats()
}
```

`snapshot(input)` accepts:

```js
{
  message,
  classification,
  channel,
  budget,
  includeSnippets
}
```

`pin()`, `unpin()`, and `warm()` publish safe events:

```text
context:pin
context:unpin
context:warm
context:snapshot
```

Events must not include file contents or raw snippets.

## 12. Runtime Integration

Modify:

```text
src/core/runtime/agent-runtime.js
src/core/execution/executor-loop.js
src/core/execution/repair-executor.js
src/core/verification/repair-loop.js
```

`createAgentRuntime()` receives:

```js
createContextSnapshot = async () => null
```

Normal tool-loop path:

```text
classify
 -> context snapshot for plan/act
 -> runExecutorLoop(context)
```

Repair path:

```text
failed verification
 -> context snapshot with channel: "repair"
 -> buildRepairMessages includes context summary
```

Query fast path should also get context:

```text
runReplyFastPath({ context })
 -> modelGateway.reply({ context })
```

The runtime must not call filesystem helpers directly. It only calls the injected `createContextSnapshot()`.

## 13. Prompt Integration

Modify:

```text
src/deepseek/prompt-assembler.js
src/core/verification/repair-prompt.js
```

`prompt-assembler.js` already supports `context.summary`; V2-9 should keep that contract and make the summary more structured.

Repair prompts should accept optional `context` and include:

```js
context_summary: context?.summary
```

They must not include raw reasoning content, API keys, hidden logs, or unbounded tool output.

## 14. Kernel Integration

Modify:

```text
src/index.js
```

Create and scan context engine:

```js
const contextEngine = options.contextEngine || createContextEngine({ root, eventBus, options: options.context || {} });
await contextEngine.scan();
```

Expose:

```js
kernel.context.snapshot(input)
kernel.context.pin(path)
kernel.context.unpin(path)
kernel.context.getStats()
```

Pass to runtime:

```js
createContextSnapshot: (input) => contextEngine.snapshot(input)
```

Tests that do not need context can disable it with:

```js
context: { disabled: true }
```

The default behavior for real kernels should be enabled.

## 15. Session Event Types

Modify:

```text
src/sessions/event-types.js
```

Add:

```text
context:snapshot
context:warm
```

`context:pin` and `context:unpin` already exist in the public facade but must be registered if not already registered.

No event may persist file contents.

## 16. Security and Privacy

Required invariants:

- No path outside project root.
- No symlink escape.
- No binary files.
- No oversized files.
- No `.env` or secret files by default.
- No `node_modules`, `.git`, `.deepseek-code`, test output, or generated build artifacts.
- No file content in session events.
- No shell commands.

The context engine is read-only. It does not execute tools and does not write project files.

## 17. Testing Strategy

Unit tests:

- `context-unit.test.js`
  - deterministic unit hash and token estimate.
  - stable priority assignment for manifests and docs.
- `workspace-indexer.test.js`
  - indexes text files.
  - skips binary, oversized, ignored directories, `.env`, and `node_modules`.
  - uses workspace path safety.
- `context-selector.test.js`
  - selects P0 stable prefix.
  - promotes mentioned files.
  - promotes pinned files.
  - respects budget.
- `context-snapshot.test.js`
  - builds summary without exceeding budget.
  - emits deterministic assembly order.
  - returns cache prefix offset.

Integration tests:

- `v2-context-kernel.test.js`
  - `kernel.context.snapshot()` returns real units.
  - `pin()` affects the next snapshot.
  - events are persisted without snippets.
- `v2-runtime-context.test.js`
  - first model `invoke()` receives context summary.
  - query fast path receives context summary.
  - repair prompt receives context summary.

Regression tests:

- Full `npm.cmd test`.
- Full `npm.cmd run check`.
- `git diff --check`.
- No `.deepseek-code/v2` pollution from tests.

## 18. Acceptance Criteria

V2-9 is complete when:

1. `kernel.context.snapshot()` no longer returns `v2_empty_snapshot`.
2. Snapshot includes real project units for common text projects.
3. Snapshot respects budget and file safety.
4. Pinned and message-mentioned files are selected ahead of cold files.
5. First model call in the normal tool loop receives `context.summary`.
6. Query fast path receives `context.summary`.
7. Repair prompt receives `context.summary`.
8. Context events are registered and persisted without file contents.
9. Existing V2-0 through V2-8 tests still pass.
10. Syntax check and whitespace check pass.

## 19. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Context scan slows kernel startup | Cap files/bytes; keep snippets small; allow `context.disabled` in tests |
| Prompt becomes too large | Strict channel budgets and deterministic truncation |
| Sensitive files leak into prompts | Skip `.env` and hidden secret-like files; no file contents in events |
| Duplicate old context code creates confusion | Put V2 code under `src/context/`; do not import `src/kernel/context-engine.js` |
| Repair prompts become noisy | Include compact summary only, not all snippets twice |
| Cache ordering changes often | Stable P0 ordering and deterministic path sorting |

## 20. Deferred Work

- Import graph and language-aware symbol summaries.
- Git diff and recent-change-aware selection.
- DeepSeek cache telemetry feedback into context budgets.
- Durable on-disk context cache.
- Model-generated file summaries.
- GUI context inspector.
- Context-aware memory selection.
- Embedding or lexical search index.

## 21. Final Summary

V2-9 makes the V2 agent stop planning blind. It adds a real, safe, deterministic context snapshot that gives DeepSeek a compact project map before the first tool call. It keeps the implementation intentionally small: no embeddings, no AST, no durable cache. The output is a stable foundation for later DeepSeek cache optimization and smarter repair.
