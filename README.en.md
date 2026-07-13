# DeepSeek Code

[简体中文](./README.md) · **English**

![version](https://img.shields.io/badge/version-v1.0.0-blue.svg)
![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![deps](https://img.shields.io/badge/core%20runtime%20deps-0-success.svg)

> A local AI coding agent for DeepSeek — **CLI · TUI · desktop GUI**, all sharing one kernel.

DeepSeek Code runs inside your project directory: it reads code, edits code, runs tests, and records every model call, tool execution, file change, and approval as a replayable, branchable, rewindable session timeline. It talks to DeepSeek models directly. **The core runtime has zero dependencies.** Node ≥ 20 and an API key is all you need.

> ⚠️ **Disclaimer:** This is an **unofficial** third-party open-source project. "DeepSeek" is a trademark of its respective owner; the name is used here only to describe model compatibility.

---

## ✨ Features

### One kernel, three frontends

The CLI, TUI, and desktop GUI all share a single kernel facade — `createKernel()` — that exposes one agent runtime, one tool-execution path, one edit/rollback service, and one session timeline. The frontends handle input, display, and approvals only; they never touch agent business logic.

- **Transactional edits & rollback** — Snapshots before writing, rollback on failure. Every change gets an id you can inspect with `changes` and undo with `rollback`.
- **Verify-repair loop** — Changes are verified after they apply, with a repair round when needed.
- **Branching & time travel** — Fork a session from any turn, or rewind to a prior state.
- **Runtime guardrails** — Timeouts for tools and model calls (120s by default); configurable caps on tokens, model calls, and malformed-tool retries. Graceful stop on limit — no hard crash.
- **Durable recovery** (opt-in) — Resume interrupted turns after a crash via project lock + transaction journal + paused-turn sidecar. Orchestration pauses can survive a process restart.

### Pillar ① Context engine — putting the right code in the prompt

- **File-level** (default): incremental workspace scan + manifest cache + path-priority ranking + per-channel token-budget greedy fill + snapshot caching.
- **Semantic-level** (optional, `--semantic-context`): retrieves by **symbol** (function/class) rather than whole file, expanding along import/call dependency edges. Built on web-tree-sitter (WASM, no native build requirements). **Supports JavaScript / TypeScript / Python.** `--include-method-hints` enables method disambiguation (unique `obj.method()` → `probable` edge). Byte-identical to file-level when disabled. Opt-in, off by default.

### Pillar ② Multi-agent orchestration — complex tasks, automatic decomposition

**One `send` call — the kernel routes to single-agent or multi-agent automatically.** Simple tasks pay zero orchestration overhead.

- **Tiered router** (on by default): obvious cases are free heuristic decisions; ambiguous cases hit a cheap model once (`router.model.enabled=false` reverts to heuristic-only).
- **Orchestration loop**: Planner decomposes → Workers execute → **two-tier independent review** (worker self-check + read-only Reviewer) → Synthesizer assembles the final answer. Failed or incomplete rounds get adaptive replanning. A cost budget gate runs throughout.
- **Parallel write isolation**: independent subtasks with non-overlapping file scopes run in parallel in fs-copied isolation workspaces; results merge back atomically with consistency checks.
- **Cross-task experience memory** (`crossTaskLearning`, off by default): sub-agents distill lessons at task boundaries into a dedicated experience store (three-tier scoring with decay + Jaccard dedup). New tasks retrieve relevant experience to inform planning. Risk-cue experience monotonically tightens permissions (allow → ask only, never loosens).
- **Durable recovery** (`recovery.enabled`, off by default): includes **cross-process orchestration-level** resume.

### Pillar ③ Three frontends — one kernel, three ways to interact

**Desktop GUI** (Electron + React + Vite; **original hand-built VS Code-style design system**, no off-the-shelf UI kits; bilingual zh/en, defaults to Chinese): real file tree · Monaco editor (local worker) · node-pty interactive terminal · settings panel (multi-API management / online model listing / edit-and-save through transactional editService / branch switching / checkpoint rewind) · **agent change tracking** (SCM "AGENT CHANGES" section → before/after side-by-side diff → hunk-to-source jump). Renderer fully sandboxed; API key masked, never crosses IPC in plaintext.

**Terminal TUI** (Claude Code-style inline-scroll session): history scrolls in the terminal's native scrollback (mouse wheel / copy / search all native); a fixed bottom region for input + status bar. Streaming typewriter preview · tool/diff/approval/orchestration cards · slash-command completion (`/help /config /diff /changes /mode /lang /clear /recovery /quit`) · `/config` shares the same API profile store as the GUI (activate rebuilds the kernel while preserving conversation context). Hand-written ANSI/VT rendering; **bilingual, defaults to Chinese**.

**CLI**: `ask / chat / edit / test / scan / search / diff / config / changes / rollback / tui` subcommands; chat REPL with `/mode` and `/recovery` (resume/cancel/clear); multi-agent orchestration summary lines.

### DeepSeek-native integration

Purpose-routed models (reply / act → flash; plan / review / repair → pro with thinking enabled; FIM via `/beta/completions`), JSON mode guard, hand-written SSE streaming, FIM code completion, tool-call repair, per-channel/per-model usage telemetry.

---

## 🚀 Quick Start

**Prerequisite:** Node.js ≥ 20.

```bash
git clone <your-repo-url> deepseek-code
cd deepseek-code
# The core CLI has no required dependencies — no npm install needed to run.

# Configure your API key (pick one)
node ./bin/deepseek-code.js config init --api-key sk-xxxx   # writes .deepseek-code/config.json
# or: export DEEPSEEK_API_KEY="sk-xxxx"                     # environment variable (bash/zsh)

# Try it out
node ./bin/deepseek-code.js help
node ./bin/deepseek-code.js ask "Explain this project's architecture"
node ./bin/deepseek-code.js edit "Fix the typos in README" --dry-run
node ./bin/deepseek-code.js edit "Fix the typos in README" --yes
node ./bin/deepseek-code.js tui
```

> After global install, use the short commands `deepseek-code` / `dsc`: `npm link` or `npm i -g .`.

---

## 🧭 Commands

| Command | What it does |
|---------|-------------|
| `ask "<question>"` | Ask a question with project context (`--semantic-context` / `--autonomy` available) |
| `chat [question]` | Interactive conversation; read-only by default, `/mode` switches `gated` / `auto`; `/recovery` manages recovery items |
| `edit "<request>"` | Generate and apply a diff; `--dry-run` previews only, `--yes` skips confirmation, `--file <path>` specifies relevant files (repeatable) |
| `test [args...]` | Run **your project's** tests and forward the exit code |
| `tui` | Open the agent-session terminal UI |
| `scan` | Scan and print the project context index |
| `search "<keyword>"` | Search project code (`--max` controls count, default 80) |
| `diff` | Show git diff |
| `config show \| init \| test` | Show effective config / write local config / test API connectivity |
| `changes list \| show [id\|latest]` | List and inspect change records (`--limit`) |
| `rollback [id\|latest]` | Roll back a specific change |

> `ask` / `chat` / `edit` also accept `--semantic-context` / `--include-method-hints`, `--no-stream`, `--max-files`, and `--max-bytes`.
> `deepseek-code test` runs **your project's** tests; `npm test` runs DeepSeek Code's own test suite.

---

## ⚙️ Configuration

**Config files** (contain API keys, gitignored): project-level `./.deepseek-code/config.json` (preferred), fallback `~/.deepseek-code/config.json`.

**Key environment variables** (override config file values):

| Variable | Default | Description |
|----------|---------|-------------|
| `DEEPSEEK_API_KEY` | — | Used when config has no `apiKey` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API base URL |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Default chat model |
| `DEEPSEEK_REASONING_EFFORT` | `high` | Reasoning effort |
| `DEEPSEEK_TOOL_TIMEOUT_MS` | `120000` | Tool-call timeout override |
| `DEEPSEEK_MODEL_TIMEOUT_MS` | `120000` | Model-call timeout override |

**Guardrail `limits`** (in `config.json` under `limits`):

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `toolTimeoutMs` | `120000` (on) | Per-tool timeout; errors rather than hard-kills on expiry |
| `modelTimeoutMs` | `120000` (on) | Per-model-call timeout (covers tool-loop, approval resume, repair paths) |
| `maxTurnTokens` | `null` (off) | Per-turn token cap; graceful stop when hit |
| `maxModelCalls` | `null` (off) | Per-turn model-call cap |
| `maxToolCallRepairs` | `null` (off) | Bounded retries for malformed tool calls |

> `null` or `≤0` disables the guardrail. Full details: [`docs/project-overview.md` §7](docs/project-overview.md#7-运行护栏与配置).

Use `config.orchestration` and `config.context.semantic` to tune multi-agent orchestration and semantic context. Set `config.recovery.enabled = true` to enable durable recovery. For a full key listing, run `node ./bin/deepseek-code.js config show` or see [`docs/project-overview.md`](docs/project-overview.md).

---

## 🏗️ Architecture

```text
CLI / TUI / GUI
   └─ src/index.js · createKernel()
        ├─ core/runtime          Agent lifecycle · executor loop · verify-repair
        ├─ core/orchestration    Multi-agent: routing · planning · parallel isolation ·
        │                          two-tier review · replanning
        ├─ core/recovery         Durable recovery (incl. orchestration-level) · project lock
        ├─ context               Tiered context engine · semantic symbol retrieval (opt-in)
        ├─ deepseek              Model gateway · routing · JSON mode · SSE streaming ·
        │                          FIM · usage tracking
        ├─ tools                 Registry · schema · executor · permission engine · 15 built-in tools
        ├─ edits                 Diff preview / apply / rollback (transactional)
        ├─ sessions              Event timeline (56 event types · JSONL + hash chain) ·
        │                          branching · rewind
        ├─ workspace · security · shared
        └─ apps/                 Shared event display contract · CLI/TUI adapters · GUI kernel host
```

Core principle: **one** kernel facade, **one** tool-execution path, **one** edit/rollback service, **one** session timeline. The frontends only handle input, display, and approvals.

> For architecture details, tool execution order, edit/rollback mechanics, recovery, security invariants, the full session-event catalog, and a directory map, see **[`docs/project-overview.md`](docs/project-overview.md)**.

---

## 🔐 Security

- File paths are realpath-validated against the workspace root; symlink escapes are blocked
- `shell` accepts structured argv only, executed with `shell:false` (no injection surface)
- `web_fetch` blocks localhost / private / link-local / IPv4-mapped IPv6 / IPv6 literal addresses; every redirect hop is re-validated
- Secrets in output are redacted (Bearer / api_key); GUI enforces `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` + IPC whitelist; API key plaintext only lives in the gitignored `.deepseek-code/` directory
- Tool categories are trusted only from the registry definition; destructive operations can never be auto-allowed by a trust rule

---

## 🧪 Development

```bash
npm test            # node --test: full suite (currently 932 passing)
npm run check       # node --check: syntax-validate all source files
```

The docs maintenance order (code → specs/plans → project-overview → CHANGELOG → index; the main README zh+en is **rewritten only on major-version updates, at the developer's discretion**) and conventions are in [`docs/README.md`](docs/README.md).

**Versioning** follows [Semantic Versioning](https://semver.org/) `major.minor.patch` from v1.0.0 onward: major versions (e.g. v2.0.0) are for large feature additions or new model-generation adaptations, **initiated by the maintainer**; minor versions add features within a major version's plan without restructuring the core; patch versions cover docs, small fixes, and tests. See [`docs/README.md` §版本命名规则](docs/README.md#版本命名规则).

---

## 📚 Docs

- **[`docs/project-overview.md`](docs/project-overview.md)** — In-depth reference: architecture, tools, edits, recovery, security, events, directory layout
- [`docs/README.md`](docs/README.md) — Doc index + maintenance conventions + version-naming rules
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — Version log (currently v1.0.0, consolidating all prior iterations)
- `docs/specs/` · `docs/plans/` — Design specs and implementation plans (organized by architecture / backend / frontend)

---

## 📄 License

[Apache-2.0](LICENSE).
