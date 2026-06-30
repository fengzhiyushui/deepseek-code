# DeepSeek Code

[简体中文](./README.md) · **English**

![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![deps](https://img.shields.io/badge/core%20runtime%20deps-0-success.svg)

> A local AI coding agent for DeepSeek — **CLI · TUI · desktop GUI**, all built on one V2 kernel.

DeepSeek Code runs inside your project directory: it reads code, edits code, runs tests, and records every model call, tool execution, file change, and approval as a replayable session timeline. It talks to DeepSeek models directly, the core CLI has **no required runtime dependencies** (pure Node standard library), and all you need is Node ≥ 20 and an API key.

> ⚠️ **Disclaimer:** This is an **unofficial**, third-party open-source project. "DeepSeek" is a trademark of its respective owner; the name is used here only to describe model compatibility.

---

## ✨ Features

- **Unified kernel** — CLI / TUI / GUI share one V2 Kernel: one agent runtime, one tool-execution path, one edit/rollback service, one session timeline.
- **Transactional edits & rollback** — snapshots before writing, rollback on failure; every change gets a change id you can inspect with `changes` and undo with `rollback`.
- **Verify-repair loop** — changes are verified after they apply, with a repair round when needed.
- **Context engine** — project files ranked into relevance tiers + a token budget + snapshot caching, so the model sees the right code.
- **Semantic context (optional)** — when enabled, retrieves by symbol (function/class) instead of whole files and expands along the import/call dependency graph; powered by web-tree-sitter (WASM, no native build dependency), supporting **JS / TS / Python** (unified tree-sitter query extraction), **off by default**. Enable with `--semantic-context`, or `--include-method-hints` to also turn on method-call hints (`obj.method()` yields a `probable` edge when the name is unique); configurable via `context.semantic.languages` and Python module roots `importRoots`.
- **Branching & time travel** — fork a session from any turn (branch), or rewind to an earlier state.
- **Automatic multi-agent orchestration** — complex requests (multiple files / sub-goals) are routed automatically by a **tiered router** (free heuristic for obvious cases, a cheap model call to judge the ambiguous middle band; **on by default**, opt-out via `router.model.enabled=false`): split into sub-tasks, executed by sub-agents (**independent, non-overlapping sub-tasks run in parallel in isolated workspaces, then merge back**), **independently reviewed (two-level)**, then synthesized; failures/incompleteness trigger **multi-round adaptation** (replan or keep dispatching from the review summary, `maxRounds` configurable) and approval pauses are **resumable** (without re-planning); simple requests take the fast path with zero overhead. Unified entry, deterministic orchestration, always-on cost gates — **no toggle needed**.
- **Cross-task experience memory (optional, off by default)** — when enabled, a secondary agent distills lessons at task boundaries into a **separate experience store** (three-tier decay + Jaccard dedup); new tasks **retrieve** relevant experience to shape planning, and **risk experiences escalate permissions** (monotonic — only tightens, never relaxes); `crossTaskLearning: "off" | "on" | "gated"`, off by default, zero-regression.
- **Durable recovery (optional)** — resume an unfinished turn after a process crash via a project lock + paused sidecar + transaction journal; **off by default**, opt-in.
- **Runtime guardrails** — tool/model call timeouts default to 120s on; token budgets, model-call caps, and malformed tool-call retries are all configurable; limits trigger a **graceful stop**, not a crash.
- **DeepSeek-native** — purpose-based model routing (reply/act/plan/review/repair/fim), a JSON-mode guard, SSE streaming, FIM code completion, usage telemetry.
- **Security baseline** — workspace-boundary realpath checks, structured-argv shell, web_fetch SSRF guard, secret redaction, a sandboxed GUI.

---

## 🚀 Quick start

**Prerequisite:** Node.js ≥ 20.

```bash
git clone <your-repo-url> deepseek-code
cd deepseek-code
# the core CLI has no required deps — no npm install needed to run it

# configure your DeepSeek API key (either way)
node ./bin/deepseek-code.js config init --api-key sk-xxxx   # writes .deepseek-code/config.json
# or via environment variable:
#   bash/zsh    : export DEEPSEEK_API_KEY="sk-xxxx"
#   PowerShell  : $env:DEEPSEEK_API_KEY="sk-xxxx"
#   CMD         : set DEEPSEEK_API_KEY=sk-xxxx

# go
node ./bin/deepseek-code.js help
node ./bin/deepseek-code.js ask "Explain this project's architecture"
node ./bin/deepseek-code.js edit "Fix the typos in the README" --dry-run
node ./bin/deepseek-code.js edit "Fix the typos in the README" --yes
node ./bin/deepseek-code.js tui
```

> After a global install you get the short `deepseek-code` / `dsc` commands (from `package.json` `bin`): `npm link` or `npm i -g .`.

> **Dependency stance:** the core CLI has no required runtime dependencies; optional semantic context (`context.semantic`) lazily loads web-tree-sitter and vendored WASM grammars, introducing no native build dependency.

---

## 🧭 Commands

| Command | What it does |
|---------|--------------|
| `ask "<question>"` | Ask a question grounded in project context |
| `chat [question]` | Continuous conversation; read-only by default, switch with in-session `/mode` → `gated` / `auto` |
| `edit "<request>"` | Generate a patch and apply it through the edit service; `--dry-run` previews, `--yes` skips confirmation, `--file <path>` hints relevant files (repeatable) |
| `test [args...]` | Run **your project's** tests and propagate the real exit code |
| `tui` | Open the interactive terminal UI |
| `scan` | Scan and print the project context index |
| `search "<pattern>"` | Search project code (`--max` caps results, default 80) |
| `diff` | Show the Git diff |
| `config show \| init \| test` | Show effective config / write local config / test the API connection |
| `changes list \| show [id\|latest]` | Inspect change records and details (`--limit`) |
| `rollback [id\|latest]` | Roll back a given change |
| `resume` | Show the most recent session records |

> Note: `deepseek-code test` runs **your project's** tests; `npm test` runs DeepSeek Code's own test suite.

---

## ⚙️ Configuration

**Config files** (both hold the API key and are `.gitignore`d, so they never enter the repo):

- project-level `./.deepseek-code/config.json` (takes precedence)
- user-level `~/.deepseek-code/config.json` (fallback)

**Environment variables** (override the matching config-file field):

| Variable | Default | Notes |
|----------|---------|-------|
| `DEEPSEEK_API_KEY` | — | used when the config file has no `apiKey` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | default chat model |
| `DEEPSEEK_REASONING_EFFORT` | `high` | reasoning effort |
| `DEEPSEEK_TOOL_TIMEOUT_MS` | `120000` | tool-timeout override |
| `DEEPSEEK_MODEL_TIMEOUT_MS` | `120000` | model-timeout override |

**Runtime guardrails `limits`** (the `limits` block in `config.json`, visible via `config show`):

| Field | Default | Meaning |
|-------|---------|---------|
| `toolTimeoutMs` | `120000` (on) | per tool-call timeout; on timeout the result is `status:"error"`, the process is not killed |
| `modelTimeoutMs` | `120000` (on) | per model-call timeout (covers the tool loop / approval resume / repair paths) |
| `maxTurnTokens` | `null` (off) | token cap per turn; on hit the turn **stops gracefully** |
| `maxModelCalls` | `null` (off) | model-call cap per turn |
| `maxToolCallRepairs` | `null` (off) | bounded retries when the model emits a malformed tool-call |

> **Config philosophy: leave the knobs to the user, within DeepSeek's constraints.** Defaults are a safe starting point, not a lock-in; `null` or `≤0` disables the corresponding guardrail. Full details in [`docs/project-overview.md`](docs/project-overview.md#7-运行护栏与配置).

---

## 🖥️ Desktop GUI

The GUI is an Electron workbench (branch / rewind visualization, approval flow, usage stats):

```bash
cd gui
npm install
npm start        # dev mode: npm run dev
```

---

## 🏗️ Architecture at a glance

```text
CLI / TUI / GUI
   └─ src/index.js · createKernel()
        ├─ core/runtime     agent lifecycle · execution loop · verify-repair
        ├─ deepseek         model gateway · router · JSON mode · streaming · FIM · usage
        ├─ tools            registry · schema · executor · permissions · builtin tools
        ├─ edits            diff preview / apply / rollback
        ├─ sessions         event timeline · branching · rewind
        └─ workspace · security · shared
```

Core principles: **one** agent runtime, **one** tool-execution path, **one** edit/rollback service, **one** session timeline; the UI only handles input, display, and approval — it owns no agent business logic.

Builtin tools: files `read` `ls` `grep` `glob` · edits `diff_preview` `diff_apply` `diff_rollback` `edit` · process `shell` `test` `git` · network `web_fetch` · memory `memory` · collaboration `task` `ask_user`.

> Architecture, tool-execution order, edits/rollback, durable recovery, security invariants, the full session-event set, and the directory map are all covered in **[`docs/project-overview.md`](docs/project-overview.md)** (Chinese).

---

## 🔐 Security

- File paths are checked against the workspace boundary via realpath, blocking symlink escapes.
- Tool categories are trusted only from the registry; destructive operations are never auto-approved by a trust rule.
- `shell` accepts only structured argv and runs with `shell:false`.
- `web_fetch` blocks localhost / private / link-local / IPv4-mapped IPv6 / IPv6-literal addresses, and re-checks after every redirect hop.
- Secrets in output are redacted; the GUI uses `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` + an IPC whitelist.

---

## 🧪 Development

```bash
npm test            # node --test: run every case under test/ and tests/
npm run check       # node --check: syntax-check all source files
git diff --check    # check line endings / conflict markers
```

The doc-maintenance order (code → specs/plans → project-overview → CHANGELOG → README zh+en → index) and conventions live in [`docs/README.md`](docs/README.md#文档维护规范与更新顺序).

---

## 📚 Documentation

- **[`docs/project-overview.md`](docs/project-overview.md)** — in-depth project guide (architecture / tools / edits / recovery / security / events / layout), in Chinese.
- [`docs/README.md`](docs/README.md) — documentation hub: index + maintenance rules.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — version milestones (the V2 line is complete; the V3 roadmap is in planning).
- `docs/specs/` · `docs/plans/` — design specs and implementation plans (split by architecture / backend / frontend).

---

## 📄 License

[Apache-2.0](LICENSE).
