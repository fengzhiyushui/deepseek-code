# V2-10 Context Cache & Usage Telemetry Design

> Status: design approved for implementation plan
> Date: 2026-05-31
> Scope: durable context manifest, incremental context scanning, stable cache prefix, and real DeepSeek usage telemetry

## 1. Purpose

V2-9 made the agent stop planning blind: it now scans the workspace, builds budgeted context snapshots, and passes `context.summary` into query, tool-loop, and repair prompts. That was the right first layer, but it has three practical limitations:

1. `createKernel()` scans the workspace on every start.
2. Context units store snippets in memory and are rebuilt even when files are unchanged.
3. DeepSeek cache usage is tracked inside `modelGateway`, but the V2 kernel and GUI do not expose it, so the UI still falls back to zero usage.

V2-10 turns context into a cache-aware subsystem. It adds a durable metadata manifest, makes scanning incremental, keeps stable prompt prefix ordering explicit, and exposes real DeepSeek usage stats to kernel clients.

## 2. Goals

1. Add a project-local context manifest that stores metadata only, never snippets or file contents.
2. Reuse unchanged file metadata across kernel restarts.
3. Keep snippet reading lazy and safe through `readWorkspaceTextFile()`.
4. Preserve deterministic context assembly order for DeepSeek prompt caching.
5. Expose real `cache_hit_tokens`, `cache_miss_tokens`, and `cache_hit_rate` through V2 kernel metrics.
6. Make GUI and TUI able to read the same usage stats without private API access.
7. Publish safe context cache events without leaking file content.
8. Maintain all V2-0 through V2-9 tests.

## 3. Non-Goals

- No embeddings or vector database.
- No AST parser or import graph.
- No model-generated file summaries.
- No GUI context inspector.
- No transactional edit changes.
- No durable approval resume.
- No prompt format rewrite outside the context summary boundary.
- No storage of raw snippets, file content, API keys, or model responses in the context manifest.

## 4. Current Behavior

`src/context/index.js` currently keeps all indexed units in memory:

```js
let units = new Map();

async function scan() {
  const indexed = await indexWorkspace({ root, options });
  units = indexed.units;
  stats = indexed.stats;
  return getStats();
}
```

`src/context/workspace-indexer.js` walks the workspace and reads every eligible file:

```js
const text = await readWorkspaceTextFile(root, file, { maxBytes: settings.maxFileBytes });
const unit = createContextUnit({
  path: text.path,
  content: text.content,
  maxSnippetBytes: settings.maxSnippetBytes
});
```

`src/deepseek/usage-tracker.js` already records DeepSeek cache fields:

```js
const cacheHit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
const cacheMiss = usage.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit);
```

But `src/index.js` does not expose `modelGateway`, `getUsageStats()`, or a metrics facade. `gui/kernel-host.js` therefore falls back:

```js
return kernel?.modelGateway?.getUsageStats?.() || kernel?.metrics?.getUsage?.() || zeroUsage();
```

## 5. Chosen Approach

Build a small V2 context cache layer under `src/context/`:

```text
src/context/
+-- context-manifest.js      # durable metadata-only manifest
+-- context-cache.js         # manifest-backed scan helper
```

The manifest lives under the existing V2 project data tree by default:

```text
<root>/.deepseek-code/v2/context/manifest.json
```

Tests should inject a temporary `context.cacheRoot` or disable persistence to avoid repository pollution.

High-level flow:

```text
createKernel(root)
 -> createContextEngine({ root, options.context })
 -> contextEngine.scan()
    -> load manifest
    -> walk workspace
    -> stat file
    -> if unchanged: reuse metadata
    -> if changed: safe-read file and update metadata
    -> save manifest

agent.send()
 -> contextEngine.snapshot()
    -> select metadata units
    -> lazy-read snippets only for selected files
    -> assemble stable context summary

GUI/TUI
 -> kernel.metrics.getUsage()
 -> modelGateway.getUsageStats()
```

## 6. Context Manifest

File:

```text
src/context/context-manifest.js
```

Manifest shape:

```js
{
  schema_version: 1,
  project_root_hash: "sha256:...",
  created_at: "2026-05-31T...",
  updated_at: "2026-05-31T...",
  files: {
    "src/index.js": {
      path: "src/index.js",
      hash: "sha256:...",
      bytes: 1234,
      token_count: 309,
      priority: 2,
      reason: "source",
      mtime_ms: 1780000000000,
      size: 1234,
      indexed_at: "2026-05-31T..."
    }
  },
  stats: {
    indexed_files: 12,
    skipped_files: 3,
    reused_files: 8,
    changed_files: 4
  }
}
```

Required invariants:

- No `snippet`.
- No `content`.
- No raw file text.
- No absolute paths except an optional hashed root identifier.
- Corrupt manifest files are ignored and rebuilt.
- Manifest writes are atomic: write temp file, then rename.

## 7. Context Cache Scan

File:

```text
src/context/context-cache.js
```

Responsibilities:

- Load the manifest.
- Walk safe workspace files using the existing indexer skip rules.
- Use `fs.stat()` metadata to decide whether a file is unchanged.
- Reuse unchanged metadata without reading file contents.
- Read changed files through `readWorkspaceTextFile()`.
- Save metadata-only manifest.

Unchanged check:

```text
same relative path
same file size
same mtime_ms
same maxFileBytes/maxSnippetBytes policy version
```

If any field differs, read and rebuild metadata. The existing content hash remains the source of truth after a file is read.

Stats returned by scan:

```js
{
  scanned_files,
  indexed_files,
  skipped_files,
  reused_files,
  changed_files,
  manifest_loaded: true,
  manifest_saved: true,
  scan_duration_ms
}
```

## 8. Lazy Snippet Hydration

V2-9 `ContextUnit` contains `snippet`. V2-10 should distinguish:

```text
ContextRecord: metadata-only, safe for manifest
HydratedContextUnit: ContextRecord + snippet, memory only
```

The selector should rank metadata records. After selection, `contextEngine.snapshot()` hydrates snippets only for selected records:

```text
selected metadata -> read selected files -> attach bounded snippets -> build summary
```

If a selected file cannot be read at snapshot time, it is skipped for that snapshot and counted as `hydrate_skipped_files`. Snapshot generation should continue.

## 9. Stable Cache Prefix

V2-10 should keep the context summary format compatible with V2-9, but make prefix accounting explicit.

Stable prefix rules:

1. P0 files always appear first.
2. P0 order is fixed:
   - `package.json`
   - `README.md`
   - `environment.yml`
   - `pyproject.toml`
   - `Cargo.toml`
   - `go.mod`
3. P0 summary text uses stable labels and separators.
4. P1/P2 files follow after P0 and may vary by message.
5. `expected_cache_prefix_offset` covers the P0 portion only.

This does not guarantee provider-side cache hits, but it maximizes prefix reuse for repeated turns in the same project.

## 10. Usage Metrics Facade

Modify:

```text
src/index.js
```

Expose:

```js
kernel.metrics.getUsage()
kernel.metrics.getContext()
kernel.metrics.getSnapshot()
```

Initial shape:

```js
metrics: {
  getUsage() {
    return modelGateway?.getUsageStats?.() || zeroUsage();
  },
  getContext() {
    return contextEngine.getStats();
  },
  async getSnapshot(input = {}) {
    return contextEngine.snapshot(input);
  }
}
```

Do not expose API keys, raw request bodies, raw messages, or context snippets through metrics.

## 11. GUI and TUI Integration

Modify:

```text
gui/kernel-host.js
src/tui.js
```

`gui/kernel-host.js` should prefer:

```js
kernel.metrics?.getUsage?.()
```

before falling back to `zeroUsage()`.

`src/tui.js` should use the same metrics facade for cache rate and token display. If metrics are unavailable, it should show zero values rather than throwing.

Renderer changes are optional in V2-10. If existing renderer already displays usage fields, no visual redesign is needed.

## 12. Events

Register safe events:

```text
context:cache_loaded
context:cache_saved
context:cache_reused
```

Event payloads may include:

```js
{
  files: 123,
  reused_files: 100,
  changed_files: 23,
  skipped_files: 5,
  duration_ms: 42
}
```

Event payloads must not include snippets, file contents, absolute file paths, API keys, or raw prompts.

## 13. Configuration

`options.context` supports:

```js
{
  disabled: false,
  persistent: true,
  cacheRoot: "<root>/.deepseek-code/v2/context",
  manifestName: "manifest.json",
  maxFiles: 1000,
  maxFileBytes: 64 * 1024,
  maxSnippetBytes: 4000,
  budgets: {
    reply: 6000,
    act: 8000,
    repair: 10000,
    think: 12000
  }
}
```

Tests that should not write to the repository must use one of:

```js
context: { disabled: true }
```

or:

```js
context: { cacheRoot: path.join(root, ".context-cache") }
```

## 14. Security and Privacy

Required invariants:

- Manifest contains metadata only.
- Hidden IDE/tool config dirs remain skipped.
- Credential-like files remain skipped.
- Snippets are memory-only and bounded.
- All file reads still go through `readWorkspaceTextFile()`.
- No context cache file is written outside the selected cache root.
- Corrupt manifests do not crash kernel startup.
- Session events and cache events do not persist file contents.

## 15. Testing Strategy

Unit tests:

- `context-manifest.test.js`
  - creates metadata-only manifest.
  - refuses to serialize `snippet` and `content`.
  - loads corrupt manifest as empty.
  - writes atomically.
- `context-cache.test.js`
  - first scan reads files and saves manifest.
  - second scan reuses unchanged metadata.
  - modified file is re-read.
  - hidden config and credential files do not enter manifest.
- Existing context tests
  - update to work with metadata records plus lazy hydration.

Integration tests:

- `v2-context-cache-kernel.test.js`
  - `createKernel()` writes manifest only under injected temp cache root.
  - reopening kernel reuses unchanged context records.
  - `kernel.context.snapshot()` still includes snippets in summary.
- `v2-usage-metrics.test.js`
  - mock DeepSeek usage with cache hit/miss tokens.
  - `kernel.metrics.getUsage()` returns real cache hit rate.
  - GUI kernel host `getUsage()` returns kernel metrics instead of zero fallback.

Regression:

- Full `npm.cmd test`.
- Full `npm.cmd run check`.
- `git diff --check`.
- No `.deepseek-code/v2` pollution from tests.

## 16. Acceptance Criteria

V2-10 is complete when:

1. Context manifest persists metadata only.
2. Reopening a kernel can reuse unchanged file metadata.
3. Changed files are re-read and update their manifest entries.
4. Snapshot summaries still include bounded snippets for selected files.
5. Hidden config and credential files are absent from both snapshot and manifest.
6. `kernel.metrics.getUsage()` exposes real DeepSeek usage stats when the gateway has them.
7. GUI host reads usage through `kernel.metrics`.
8. Context cache events are registered and contain no file contents.
9. All V2-0 through V2-9 tests still pass.
10. Syntax, whitespace, and pollution checks pass.

## 17. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Manifest leaks code snippets | Serialize only whitelisted metadata fields |
| Stale metadata after filesystem changes | Compare size and mtime before reuse; re-read changed files |
| Provider cache does not hit despite stable prefix | Expose usage telemetry so actual hit rate can guide V2-11 |
| Tests pollute repository `.deepseek-code/v2` | Require temp `cacheRoot` or `context.disabled` in tests |
| Startup still slow on very large repos | Keep maxFiles cap; reuse manifest; report scan duration |
| Hidden config leaks through new patterns | Keep denylist tests and add credential-token filename checks |

## 18. Deferred Work

- Context inspector GUI panel.
- Git-diff-aware context selection.
- Import graph and symbol summaries.
- Model-generated long-file summaries.
- DeepSeek cache-budget auto tuning.
- Cross-process context cache locking.
- Transactional edit.

## 19. Final Summary

V2-10 makes V2-9 practical for repeated real use. It keeps context safe and deterministic, avoids rereading unchanged files, and exposes real DeepSeek cache telemetry so the project can optimize with evidence rather than guesses. The design intentionally avoids semantic indexing and GUI redesign; those become more valuable after the cache and usage foundation is visible.
