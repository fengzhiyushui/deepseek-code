# DeepSeek Code 项目说明(内部)

> 这是面向**维护者 / 贡献者**的深入说明。对外的简介、安装与命令速查见根目录 [`README.md`](../README.md) / [`README.en.md`](../README.en.md);本文件覆盖架构内核、工具平面、编辑回滚、持久化恢复、安全不变量、会话事件全集、存储布局与目录地图。所有内容均以当前 `src/` 代码为准。

---

## 1. 架构与内核

```text
CLI / TUI / GUI
   └─ src/index.js · createKernel()
        ├─ core/runtime     Agent 生命周期 · 执行循环 · 验证-修复
        ├─ deepseek         模型网关 · 路由 · JSON mode · streaming · FIM · 用量
        ├─ tools            注册表 · schema · executor · 权限 · 内置工具
        ├─ edits            diff 预览 / 应用 / 回滚
        ├─ sessions         事件时间线 · 分支 · rewind
        └─ workspace · security · shared
```

核心原则:**一个** Agent runtime、**一条** 工具执行路径、**一套** 编辑/回滚服务、**一条** 会话时间线;UI 只负责输入、展示与审批,不持有 agent 业务逻辑。

### `createKernel(root, options)`

[`src/index.js`](../src/index.js) 是组合根。常用 `options`:

| 选项 | 默认 | 说明 |
|------|------|------|
| `sessionRoot` | `<root>/.deepseek-code/v2/sessions` | 会话时间线存储根;测试可注入临时目录 |
| `limits` | 见 [§7](#7-运行护栏与配置) | 运行护栏(超时 / token / 调用次数 / 畸形 tool-call 重试) |
| `recovery.enabled` | `false` | 持久化恢复总开关,**默认关闭**(opt-in,见 [§6](#6-持久化恢复)) |

kernel facade 主要方法:`send()`(发起一个 turn)、`approve()`(审批并 resume 暂停的 turn)、`dispose()`(幂等释放项目锁);恢复启用时还暴露 `abortJournal()` / `commitJournal()`。

### turn 生命周期

```text
user:message
  → 模型调用(model:request / model:response)
  → 工具循环(见 §3 固定顺序)
  → 验证-修复(verification:result → 必要时 repair:*)
  → 终态:agent:final(status = ok | stopped)或 agent:error
```

命中成本护栏(`maxTurnTokens` / `maxModelCalls`)时,turn **优雅停止**:发 `agent:final` 且 `status:"stopped"`,跳过 verify/repair,`send()` 正常返回 `{ status:"stopped", content, budget }`,而非抛错。

---

## 2. DeepSeek 适配

[`src/deepseek/`](../src/deepseek/) 负责 DeepSeek 专属协议。

### 模型路由([`model-router.js`](../src/deepseek/model-router.js))

按"用途"路由到不同模型与参数:

| 用途 | channel | 模型 | thinking | 流式 | 备注 |
|------|---------|------|----------|------|------|
| `reply` / `act` | `act` | `deepseek-v4-flash` | disabled | 是 | 日常对话与工具调用 |
| `plan` / `review` / `repair` | `think` | `deepseek-v4-pro` | enabled(`reasoning_effort: high`) | 否 | 规划 / 评审 / 修复 |
| `fim` | `fim` | `deepseek-v4-pro` | — | — | 代码补全,走 `/beta/completions` |

- `reply` 且 `complexity:"high"` 时自动改走 `plan` 档。
- 模型 id 是项目当前的默认值,可经 `DEEPSEEK_MODEL` 或 `config.json` 覆盖。

### 其余协议件

- **JSON mode guard**([`json-mode.js`](../src/deepseek/json-mode.js)):只有明确要求结构化 JSON 的调用才启用 `response_format`。
- **SSE streaming**([`streaming.js`](../src/deepseek/streaming.js)):流式解析。
- **tool-call 规范化 + 畸形重试**([`tool-call-repair.js`](../src/deepseek/tool-call-repair.js)):规范化模型吐出的 tool-call;参数非法 JSON 时按 `maxToolCallRepairs` 有界重试(发 `model:tool_call_repair`)。
- **用量遥测**([`usage-tracker.js`](../src/deepseek/usage-tracker.js)):token、reasoning token、cache hit/miss、latency。
- **超时**([`model-gateway.js`](../src/deepseek/model-gateway.js)):`invoke` / `stream` 支持 `timeoutMs`,超时抛 `MODEL_TIMEOUT`(与调用方 signal 合并)。

---

## 3. 工具平面

[`src/tools/`](../src/tools/) 提供注册表、schema、executor 与权限引擎。内置工具([`builtin/index.js`](../src/tools/builtin/index.js)):

| 类别 | 工具 |
|------|------|
| 文件 | `read` · `ls` · `grep` · `glob` |
| 编辑 | `diff_preview` · `diff_apply` · `diff_rollback` · `edit` |
| 进程 | `shell` · `test` · `git` |
| 网络 | `web_fetch` |
| 记忆 | `memory` |
| 协作 | `task` · `ask_user` |

编辑类工具是"延迟绑定"的([`builtin/edit-deferred.js`](../src/tools/builtin/edit-deferred.js)),在内核装配时注入 `editService`:`diff_preview → preview`、`diff_apply`/`edit → apply`、`diff_rollback → rollback`。

### 固定执行顺序

```text
ToolCall
  → schema validation
  → parameter normalization
  → permission decision
  → approval(若需要)
  → execution
  → result redaction
  → tool:result 事件
  → model feedback
```

**工具超时**:`executor` 支持 `defaultToolTimeoutMs` / `context.toolTimeoutMs`;超时落为标准 `status:"error"` 结果(`metadata.timeout = true`),**不抛错、不强杀进程**。

---

## 4. 编辑与回滚

[`src/edits/`](../src/edits/) 把成熟的 diff pipeline 暴露为 `EditService`:

- `preview(diff)` —— 解析 diff 并生成摘要,不写文件。
- `apply({ diff, prompt, approval_id })` —— 预检路径 → 建快照 → 应用 diff → 记录 change id。
- `rollback(change_id)` —— 回滚指定变更。
- `describe(change_id)` / `list({ limit })` —— 查看变更记录。

变更记录落在 `.deepseek-code/changes/<id>.json`,回滚记录落在 `.deepseek-code/rollbacks.jsonl`。

---

## 5. 会话、分支与 rewind

- **时间线**:每个会话是一个 append-only JSONL,存于 `.deepseek-code/v2/sessions/<projectId>/<sessionId>.jsonl`([`sessions/event-log.js`](../src/sessions/event-log.js))。
- **分支**:可从任意 turn 分叉,记录于同目录 `<sessionId>.branches.json`([`sessions/branch-store.js`](../src/sessions/branch-store.js))。
- **rewind**:回到历史状态([`sessions/rewind-service.js`](../src/sessions/rewind-service.js))。

### 事件全集

事件类型由 [`sessions/event-types.js`](../src/sessions/event-types.js) 集中定义(`SESSION_EVENT_TYPES`,当前约 56 种),按前缀分类:

| 前缀 | 覆盖 |
|------|------|
| `session:` | start / resume / branch_created / branch_activated / rewind_*(preview/started/applied/conflict/failed/restore_started/restored/recovery_failed) |
| `recovery:` | started / blocked / report |
| `tx:` | opened / committed / recovered |
| `turn:` | paused / rehydrated / resumed / cancelled |
| `takeover:` | requested / completed |
| `user:` / `agent:` | user:message · agent:turn_started / step / final / error |
| `model:` | request / response |
| `tool:` / `permission:` / `approval:` | tool:call / result · permission:decision · approval:requested / resolved |
| `context:` | snapshot / pin / unpin / warm / cache_loaded / cache_saved / cache_reused |
| `file:` | diff_preview / diff_applied / rollback_applied / transaction_*(started/committed/failed/rolled_back) / rollback_conflict |
| `verification:` / `repair:` | verification:result · repair:started / attempt / result / exhausted |

> 以代码为准:新增事件须同步登记到 `SESSION_EVENT_TYPES`,否则 `assertSessionEventType` 会拒绝。

---

## 6. 持久化恢复

跨进程崩溃安全恢复(V2-18 引入),**默认关闭**;开启:`createKernel(root, { recovery: { enabled: true } })`。**关闭时,edit/rewind 行为逐字节不变。**

组成([`src/core/recovery/`](../src/core/recovery/)):

- **项目锁 + epoch fencing**:`.deepseek-code/v2/.lock`,防并发写;`kernel.dispose()` 幂等释放。
- **暂停 sidecar 持久化**:`.deepseek-code/v2/sessions/<projectId>/paused/`,审批暂停的 turn 落盘以便重水化。
- **恢复收件箱**:`.deepseek-code/v2/recovery/inbox.json`,启动扫描登记待恢复项。
- **事务日志**:`.deepseek-code/v2/journal/`,edit/rewind 写文件前 `open()`、成功 `commit()`、失败 `abort()`(恢复 preimage)。
- **CLI `/recovery`** 与启动扫描:发现 open/aborting/committed/corrupt 日志并入收件箱。

详见设计文档 [`specs/backend/2026-06-01-v2-18-durable-recovery-resume-hardening-design.md`](specs/backend/2026-06-01-v2-18-durable-recovery-resume-hardening-design.md)。

---

## 7. 运行护栏与配置

> 配置哲学:**在适配 DeepSeek 的前提下,参数尽量交给用户。** 默认值只给"安全合理的起点",不锁死;每个旋钮都能覆盖。

护栏经 `createKernel(root, { limits })` 生效,默认值来自配置([`src/config.js`](../src/config.js) 的 `DEFAULT_CONFIG.limits`,是默认值的单一来源):

| 参数 | 默认 | 含义 |
|------|------|------|
| `toolTimeoutMs` | `120000`(开) | 单次工具调用超时;超时落为 `status:"error"`,不强杀进程 |
| `modelTimeoutMs` | `120000`(开) | 单次模型调用超时(工具循环 / 审批 resume / 修复三路径均覆盖) |
| `maxTurnTokens` | `null`(关) | 单个 turn 的 token 上限;命中后优雅停止(`status:"stopped"`) |
| `maxModelCalls` | `null`(关) | 单个 turn 的模型调用次数上限 |
| `maxToolCallRepairs` | `null`(关) | 模型吐出畸形 tool-call 时的有界重试次数 |

**取值语义**(`toLimit`):省略 → 取默认;`null` → 关闭;`≤0` 或非法 → 关闭;否则取整。

**覆盖方式**:① 编辑 `config.json` 的 `limits`;② 环境变量 `DEEPSEEK_TOOL_TIMEOUT_MS` / `DEEPSEEK_MODEL_TIMEOUT_MS`。`loadConfig` 对用户 `limits` 做 per-field 深合并。

```json
{ "limits": { "toolTimeoutMs": 180000, "maxTurnTokens": 200000, "maxModelCalls": 40, "maxToolCallRepairs": 1 } }
```

**配置文件位置**:项目级 `./.deepseek-code/config.json`(优先)与用户级 `~/.deepseek-code/config.json`(回退);本地覆盖用户级。CLI 与 GUI 的 `buildKernelOptions` 都把 `config.limits` 透传给 `createKernel`。

---

## 8. 安全不变量

- 文件路径以 realpath 校验 workspace 边界,阻断 symlink 逃逸([`workspace/path-safety.js`](../src/workspace/path-safety.js))。
- 工具 category 只信任注册表定义,不信任模型传入字段。
- destructive 操作永不被 trust rule 自动放行。
- `shell` 只接受结构化 argv,以 `shell:false` 执行([`security/shell-policy.js`](../src/security/shell-policy.js))。
- `web_fetch` 阻断 localhost / 私网 / link-local / IPv4-mapped IPv6 / IPv6 literal,且每跳 redirect 后重新校验([`security/ssrf.js`](../src/security/ssrf.js))。
- 输出中的密钥会被脱敏([`security/redactor.js`](../src/security/redactor.js))。
- GUI 采用 `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` + IPC 白名单。

---

## 9. 本地存储布局

整个 `.deepseek-code/` 已被 `.gitignore` 忽略,不入库:

```text
.deepseek-code/
  config.json                  本地配置(含 API Key)
  changes/<id>.json            变更记录
  rollbacks.jsonl              回滚记录
  sessions.jsonl               旧版会话日志(resume 命令读取)
  v2/
    sessions/<projectId>/
      <sessionId>.jsonl        V2 会话时间线
      <sessionId>.branches.json 分支
      paused/                  暂停 sidecar(恢复启用时)
    context/                   上下文缓存
    recovery/inbox.json        恢复收件箱
    journal/                   事务日志
    .lock/                     项目锁
```

---

## 10. 目录地图

```text
src/
  index.js        createKernel() 组合根
  core/
    runtime/      agent-runtime · lifecycle · cost-budget
    execution/    executor-loop · repair-executor · tool-call-adapter · tool-result-router
    verification/ verifier · repair-loop · repair-decision · repair-prompt · verification-policy
    protocol/     agent-turn · agent-step · tool-call · tool-result · approval-request · artifact
    planning/     classifier
    approval/     paused-turn-store
    recovery/     项目锁 · 收件箱 · 暂停持久化 · 事务日志 · 恢复服务(opt-in)
  deepseek/       model-gateway · model-router · json-mode · streaming · fim-client · usage-tracker · tool-call-repair · prompt-assembler · api-errors
  tools/          registry · schema · executor · builtin/* · permissions/*
  edits/          diff-parser · change-store · rollback-service · edit-transaction · edit-service
  sessions/       event-types · event-log · branch-store · checkpoint-index · rewind-transaction · rewind-service · session-manager
  context/        context-unit · token-budget · workspace-indexer · context-selector · context-snapshot · context-manifest · context-cache
  workspace/      path-safety
  security/       shell-policy · ssrf · redactor
  apps/           kernel-options · cli/(render-events · kernel-runner)
  shared/         id · time · event-bus
  (顶层)         cli.js · config.js · context.js · git.js · patch.js · changes.js · provider.js · search.js · theme.js · tui.js
gui/              Electron:main.js · preload.js · kernel-host.js · renderer/*
docs/             specs/ · plans/ · CHANGELOG.md · README.md(文档中心)
tests/ + test/    单元 / 集成 / e2e
preview-deepseek-code/ · DeepSeekCodeIDE.jsx   前端原型(V3 Phase D,未接入运行时)
```

> 顶层 `cli.js`/`config.js`/`context.js`/`git.js`/`patch.js`/`changes.js`/`provider.js`/`search.js`/`theme.js`/`tui.js` 是 V1 时代保留、现作为 V2 共享依赖的工具模块,**不属 legacy**;V1 并存内核(`src/kernel/*`、`agent.js`、`chat.js`、`ui.js`)已于 V2-19 删除。

---

## 11. 已知限制

- 持久化恢复默认关闭(opt-in);未开启时,会话 / 变更 / 分支**无跨进程文件锁**——勿在同一项目目录并发运行多个会写状态的实例。
- repair executor 目前是单轮修复执行器;多轮自动诊断与更复杂的验证策略待扩展。
- GUI 用量统计在离线或未接入真实模型调用时可能显示零值。
- 模型 id(`deepseek-v4-flash` / `deepseek-v4-pro`)是项目当前默认值,以 `config.json` / `DEEPSEEK_MODEL` 为准覆盖。

---

## 12. 开发与文档维护

```bash
npm test            # node --test:test/ 与 tests/ 下全部用例
npm run check       # node --check:全部源码语法校验
git diff --check
```

文档更新顺序与规范(代码 → specs/plans → project-overview → CHANGELOG → README 中+英 → 索引)见 [`docs/README.md`](README.md#文档维护规范与更新顺序)。

---

## 13. 语义级上下文引擎(可选,opt-in)

> V3 Phase B 引入(B+1 方法消歧、B+3 query 统一抽取 + 扩 Python)。设计见 [Phase B](specs/backend/2026-06-26-v3-phase-b-semantic-context-design.md) · [B+1](specs/backend/2026-06-26-v3-phase-b-plus1-method-hints-design.md) · [B+3](specs/backend/2026-06-26-v3-phase-b-plus3-multi-language-design.md);实施见 [Phase B plan](plans/backend/2026-06-26-v3-phase-b-semantic-context.md) · [B+3 plan](plans/backend/2026-06-26-v3-phase-b-plus3-multi-language.md)。

在现有文件级上下文之上增加**符号层**,**默认关闭**(`context.semantic.enabled`);关闭时引擎行为(单元、事件、快照)与文件级**逐字节一致**。

启用后:web-tree-sitter(WASM,随仓 vendored grammar,放 `optionalDependencies`,仅启用时懒加载)解析 **JS / TS / Python**(tree-sitter query 统一抽取,每语言一份定义)→ 符号表 + import/export 绑定 + **尽力静态调用图**(直接调用 `resolved`;`obj.method()` / 动态调用标 `unresolved`,每条边带 `confidence` / `reason`)→ symbol-selector 从种子符号沿依赖图扩 N 跳、按预算选**符号级**片段;不支持 / 解析失败的文件回退文件级单元;provider 整体不可用则全量退回文件级,**永不崩**。

配置(`config.json` 或 `createKernel(root, { context: { semantic: { enabled: true } } })`):

| 字段 | 默认 | 含义 |
|------|------|------|
| `enabled` | `false` | 总开关 |
| `hops` | `2` | 依赖图扩展跳数 |
| `maxSymbols` | `200` | 候选符号上限(成本闸) |
| `includeMethodHints` | `false` | 方法调用消歧(B+1):`obj.method()` 项目内唯一同名 → `probable` 边 |
| `languages` | `["js","ts","py"]` | 启用的语言(白名单 js/ts/py,去重) |
| `importRoots` | `[]` | Python 模块搜索根(**追加**非替换;`[]` ≡ 仅项目根) |

模块位于 [`src/context/semantic/`](../src/context/semantic/):parser-provider · wasm-tree-sitter-provider · **query-extractor**(通用 runner:query.matches 组装 + 字节序排序 + enclosing + 降级)· **language-registry** + **languages/{javascript,typescript,python}**(每语言 query + 处理器)· **symbol-id** · symbol-cache · symbol-indexer · module-resolver · **python-module-resolver** · dependency-graph · symbol-unit · symbol-selector · semantic-engine。新事件 `context:symbol_indexed` / `context:graph_built` **仅在语义启用时**触发。

---

## 14. 多智能体编排(V3 Phase C1+C2)

> 设计见 [C1+C2 spec](specs/backend/2026-06-27-v3-phase-c1-c2-orchestration-design.md);实施见 [C1+C2 plan](plans/backend/2026-06-27-v3-phase-c1-c2-orchestration.md)。

**单 / 多 agent 合并为一条路**:`kernel.agent.send()` 内部经**确定性路由器**(`task-router.js`,升级 `classifier`,启发式、无模型调用、无 on/off 开关)判复杂度 ——

```
kernel.send(message) → task-router
   ├─ lane="single"      → agentRuntime.send()   今天的路径,逐字节零回归、不发新事件
   └─ lane="orchestrate" → orchestrator.run()     Planner → 串行 Worker → 两级审核 → Synthesizer
```

**关键不变量**:`agent-runtime.js` **一行未改** —— Worker / Reviewer 都是 `createAgentRuntime` 实例(经 `createRuntime` 覆盖工厂注入**工具子集** + **作用域上下文**),编排层只在公开边界 `send()` 之上组合。

**组件**([`src/core/orchestration/`](../src/core/orchestration/)):

| 单元 | 职责 |
|------|------|
| `task-router` | 启发式判 `single \| orchestrate`(markers + 文件数信号),产出 `RoutingDecision` |
| `subtask-schema` | `Plan` / `SubTask` / `Verdict` 校验 + `topoOrder`(环检测) |
| `planner` | 模型(thinking)→ 结构化 `Plan`;schema 校验 + 有界重试 + 环检测 + **降级单子任务** |
| `tool-profiles` | 从 registry 过滤 `edit` / `readonly` 工具子集 |
| `worker-factory` | 按 `SubTask` 建 Worker(`edit`)/ Reviewer(`readonly`)runtime |
| `reviewer` | **独立**只读复查 Worker 产出 → `Verdict`;不可解析则保守 `pass:false/warn` |
| `dispatch-loop` | 确定性循环:topo 串行 + 关卡1 子自审重试 + 关卡2 打回重试 + `maxWorkerAttempts` 有界 + 预算命中→部分完成 |
| `synthesizer` | 汇总子任务产出 + 失败诚实汇报(模型,失败回退确定性摘要) |
| `orchestrator` | 组装上述 + 聚合成本闸 + 发 `orchestration:*` 事件 + `maxSubtasks` 截断 |

**两级审核**:关卡1 = Worker 内置 `verifyAndMaybeRepair`(局部、便宜);关卡2 = 独立 Reviewer(全局、只读工具物理不可改)。确定性 gate 读 `verdict.pass` 决定收 / 打回。

**成本闸常开**(`config.orchestration`,无 on/off):`maxSubtasks` / `maxWorkerAttempts` / `budget`(聚合 token + 调用数,planner/worker/reviewer/synth 全计入)。命中→**优雅停止 + 部分完成**,不抛不崩。

**事件**:`orchestration:routed` / `:planned` / `:subtask_started` / `:subtask_reviewed` / `:completed`,**仅 `orchestrate` 档触发**(`single` 档与今天一致)。

**非目标(留后续片)**:C3 并行 Worker 的 worktree 写隔离、C4 跨任务经验记忆、C5 Reviewer 打回触发重规划 / 持续派发、编排级 durable 恢复、模型驱动路由(已规划为 router 的分层增强:明显档免费启发式,模糊档才调模型)。
