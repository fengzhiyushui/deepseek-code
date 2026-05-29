# DeepSeek Code v1 Architecture Design

> 状态：v1 基线锁定 | 2026-05-29

## 1. 项目目标

打造一个**完美适配 DeepSeek** 的本地编程助手，参考 Claude Code 和 Codex 的 Agent 架构，底层深度利用 DeepSeek V4 特性。支持 CLI、TUI、GUI 三种界面，共享同一套 Agent Kernel。

### 核心设计原则

- **双通道推理架构**：Think（深度推理）+ Act（快速执行）
- **1M 上下文窗口智能利用**：冷热温三层记忆 + cache-aware
- **多级自治光谱**：从 supervised 到 full-auto
- **可编程权限**：用户策略优先 + 项目规则 + 默认矩阵
- **三层工具系统**：内置工具 + MCP 协议 + JS/TS 插件
- **Append-only event log**：全事件追踪，CLI/TUI/GUI 共享

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                      用户界面层                            │
│  ┌──────────────────┐   ┌──────────────┐   ┌──────────┐ │
│  │   CLI REPL        │   │ TUI (Ink)    │   │ GUI      │ │
│  │ (deepseek-code)   │   │              │   │(Electron)│ │
│  └────────┬─────────┘   └──────┬───────┘   └────┬─────┘ │
│           │                    │                 │       │
│           └────────────────────┼─────────────────┘       │
│                                │                         │
│                      Kernel API (IPC / direct call)       │
├────────────────────────────────┼─────────────────────────┤
│                       Agent Kernel                         │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           Task Orchestrator（任务编排器）               │ │
│  │                                                       │ │
│  │   Idle → Classify → ThinkPlan → ActExecute            │ │
│  │              → ThinkReview → Verify → Complete        │ │
│  │                                                       │ │
│  │   状态机驱动 · Fast paths · 多级自治 · 事件化转移       │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌───────────────────┐   ┌────────────────────────────┐   │
│  │   Think Channel     │   │     Act Channel            │   │
│  │                     │   │                            │   │
│  │ thinking: enabled   │   │ thinking: disabled         │   │
│  │ reasoning_effort:   │   │ temperature: 0.1           │   │
│  │   high / max        │   │ stream: true               │   │
│  │ model: v4-pro       │   │ model: v4-flash            │   │
│  │ 1M context 可用     │   │ 64K context 预算           │   │
│  │ 只读工具为主        │   │ 读写工具，权限约束          │   │
│  │                     │   │                            │   │
│  │ 产出：analysis,     │   │ 产出：diff, code,          │   │
│  │ plan, risks,        │   │ tool_calls,                │   │
│  │ targets, strategy   │   │ verification output        │   │
│  └───────────────────┘   └────────────────────────────┘   │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           Context Engine（上下文引擎）                  │ │
│  │                                                       │ │
│  │  selection → compression → cache boundary → assembly  │ │
│  │  冷/温/热三层 · channel-specific prompts · token budget│ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           Permission Engine（权限引擎）                 │ │
│  │                                                       │ │
│  │  用户策略 > 信任项目JS > 项目声明式 > 默认矩阵           │ │
│  │  结构化匹配 · TTL绑定指纹 · 路径规范化                  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           Tool System（工具系统）                       │ │
│  │                                                       │ │
│  │  内置工具 · MCP 协议 · JS/TS 插件                       │ │
│  │  统一 ToolDefinition → ToolCall → ToolResult           │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           Session Manager（会话管理）                   │ │
│  │                                                       │ │
│  │  append-only event log · snapshot ref · recoverable    │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           Model Provider（DeepSeek 适配层）             │ │
│  │                                                       │ │
│  │  双通道参数模板 · FIM 接入 · 重试降级 · 用量追踪        │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 内核模块接口原则

1. **内核是一组独立模块，通过明确接口通信**
2. **CLI / TUI / GUI 都是薄壳**，只负责渲染和输入，不包含 Agent 逻辑
3. **Think 和 Act 通道共享工具系统**，但权限策略不同：Think 只读、Act 读写受控
4. **调用链**：`Channel → Tool Gateway (Resolver + Normalizer) → Permission Engine → Tool Executor`，工具自身不判断权限
5. **Kernel 单写原则**：Session Event Log 只有一个 active writer（Kernel Service），GUI/CLI/TUI 作为 clients

### UI State Adapter

```
Session Event Log → UI State Adapter → Surface/Context/Control ViewModel
```

Renderer 不直接消费原始 event log，防止 tool/model/context 噪声拖垮 UI。

---

## 3. Task Orchestrator（任务编排器）

> v1.1 — event-driven explicit state machine

### 状态机

```
                              Fast Paths
  ┌──────┐  query/simple    ┌──────────────┐    ┌──────────┐
  │ Idle │─────────────────▶│ ActExecute*  │───▶│ Complete │
  └──┬───┘                  └──────────────┘    └──────────┘
     │                        ┌──────────┐
     │  explain/diagnose      │ThinkReply │────▶│ Complete │
     ├───────────────────────▶│ (Answer)  │
     │                        └──────────┘
     │  ┌────────────────────────────────────────────────────────┐
     │  │                  Standard Loop                          │
     │  │                                                        │
     └─▶│ Classify ──▶ ThinkPlan ──▶ ActExecute ──▶ ThinkReview │
        │                ▲               │              │        │
        │                │               ▼              ▼        │
        │                │         ┌──────────┐  ┌───────────┐  │
        │                │         │ActRepair │  │ Verify    │  │
        │                │         └────┬─────┘  │Act+Think  │  │
        │                │              │         └─────┬─────┘  │
        │                │              │               │        │
        │                └──────────────┴───────────────┘        │
        │                      (失败/需修复时回环)                  │
        └────────────────────────────────────────────────────────┘
     │
     │  ┌──────────────────────────────────────────────────┐
     │  │              Cross-cutting States                 │
     │  │                                                  │
     ├──▶│ AwaitApproval(plan | execute | review | perm)   │
     │   │   └── 用户确认 ──▶ 回到中断点继续                 │
     │   │                                                  │
     └──▶│ Terminal                                         │
         │   └── recoverable blocked state                  │
         │      └── 用户补充信息 ──▶ Classify               │
         └──────────────────────────────────────────────────┘
```

### 状态职责

| 状态 | 职责 | 默认通道 | 退出条件 |
|------|------|----------|----------|
| **Idle** | 等待用户输入 | — | 收到消息 → Classify |
| **Classify** | 判断任务类型/自治级别/初始通道 | Think | → ThinkPlan / Fast paths |
| **ThinkPlan** | 深度分析，产出结构化 plan/risks/targets/strategy | Think | plan 完成 → ActExecute |
| **ThinkReply** | 解释/诊断类，不产生 diff | Think | 答案产出 → Complete |
| **ActExecute** | 按 plan 执行修改/搜索/测试 | Act | 执行完成 → ThinkReview / Complete |
| **ThinkReview** | 审查 diff 质量、风险验证 | Think | 通过 → Verify；不通过 → ActRepair |
| **ActRepair** | 根据 review 反馈修复 | Act | 修复 → ThinkReview；大修 → ThinkPlan |
| **Verify** | ActVerify（测试/lint/diff）+ ThinkVerify（结果解读） | Act+Think | 通过 → Complete；失败 → ActRepair |
| **Complete** | 记录结果，写入 event log | — | → Idle |
| **AwaitApproval** | 显式等待用户决策 | — | 用户确认 → 回到中断点 |
| **Terminal** | recoverable blocked state：缺信息/权限/外部失败 | — | 用户输入 → Classify |

### Fast Paths

所有请求经过 Classify。query/simple 类任务直接路由到 ActExecute* 或 ThinkReply，跳过 ThinkPlan，减少开销。

### 自治级别

| 级别 | Plan 确认 | Execute 确认 | Review 确认 | 适用场景 |
|------|-----------|-------------|-------------|----------|
| **supervised** | 必须 | 每步 | 必须 | install/network/destructive |
| **gated**（默认） | 必须 | 自动 | 必须 | write/edit 类型任务 |
| **auto** | 自动 | 自动 | 必须 | read/query 类型任务 |
| **full-auto** | 自动 | 自动 | 自动 | 用户显式 --auto 或 "just do it" |

### 状态转移事件 schema

```jsonc
{
  "schema_version": 1,
  "state": {
    "entered": "ThinkPlan",
    "exited": "Classify"
  },
  "transition": {
    "reason": "classification complete: task=refactor, risk=medium",
    "autonomy": { "level": "gated" },
    "channel": "think",
    "approval": { "required": true, "type": "plan" }
  },
  "trace": {
    "id": "trace_abc123",
    "timestamp": "..."
  }
}
```

---

## 4. Context Engine（上下文引擎）

> v1.1

### ContextUnit 抽象

```
ContextUnit {
  id          : string          // 唯一标识
  type        : file | diff | search_result | test_output
              | conversation | project_index | tool_output
  source      : string          // 来源路径或工具名
  content_ref : string          // 内容存储 key（content-addressed）
  token_count : number
  hash        : string          // SHA256 内容哈希
  freshness   : timestamp
  priority    : P0..P4          // P0=system policy, P4=pinned
  dependencies: string[]        // 关联 unit id 列表
}
```

### 冷/温/热 三层记忆模型

```
┌────────────────────────────────────────────────────────────────┐
│                     1M Token Window                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🔥 HOT LAYER — 始终在窗口内，带 budget 管控               │  │
│  │  P0: system prompt / channel policy / tool schemas       │  │
│  │  P1: 当前用户请求 / active diff / 最近状态                 │  │
│  │  P2: 当前目标文件（before+after）                          │  │
│  │  P3: 项目骨架 / 关键配置 / import 图摘要                   │  │
│  │  P4: 用户 pinned files（最多 5 项）                        │  │
│  │  总数受 maxBudget 强制截断                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🌤  WARM LAYER — 按 scoring 换入换出                     │  │
│  │  最近文件 / 搜索结果 / 依赖文件 / 测试输出                  │  │
│  │  score = relevance + recency + dependency_distance        │  │
│  │        + active_edit_bonus + pinned_bonus                 │  │
│  │        + test_failure_bonus - token_cost_penalty          │  │
│  │  LRU 仅作为 tie-breaker                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ❄️ COLD LAYER — 磁盘按需加载后升入温层                   │  │
│  │  项目其他文件全文 / 历史对话 / 变更记录 / 测试历史           │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 通道专属策略

| 维度 | Think 通道 | Act 通道 |
|------|-----------|----------|
| **默认窗口预算** | 500K tokens（用户可配到 1M） | 64K tokens（repair loop 内可放宽至 128K） |
| **热层内容** | 完整 system prompt + 项目骨架 | 精简 system prompt + 当前文件上下文 |
| **温层策略** | 依赖图换入，scoring 排序 | 只保留操作目标文件，repair loop TTL 内缓存 |
| **prompt 组装** | 完整 structured output schema | 精简 schema，unified diff 格式 |
| **cache 前缀** | 稳定 system prompt + config + tool schema | 稳定 prefix，volatile tail 每次刷新 |
| **Act 缓存 TTL** | — | `min(current_turn_lifetime, repair_loop_lifetime)` |

### Cache-Aware 前缀设计

稳定前缀（跨请求不变，命中 cache）：
- system prompt
- channel policy
- tool schemas
- stable project index（不常变）
- stable config summaries

Volatile tail（每次可能变化）：
- current user request
- recent conversation turns
- selected file contents
- diffs / tool outputs / test results

### Snapshot 引用

```jsonc
{
  "snapshot_id": "snap_abc123",
  "channel": "think",
  "units": ["unit_id_1", "unit_id_2"],
  "unit_hashes": ["sha256:a1b2...", "sha256:c3d4..."],
  "assembly_order": ["P0:*", "P1:*", "P2:target_file"],
  "compression_policy_id": "think_v1",
  "expected_cache_prefix_offset": 15000,
  "file_revision_hashes": { "src/a.js": "sha256:x1y2..." },
  "budget": { "allocated": 500000, "used": 210000 }
}
```

可复现：引用 content-addressed blobs，文件后来变了也能复现当时上下文。

### Invalidation 触发

| 事件 | 失效范围 |
|------|---------|
| file hash changed | 该文件 unit + 所有依赖它的 unit |
| dependency graph changed | project index unit |
| package/config changed | tool/runtime assumptions units |
| test output 早于最后一次 edit | 该 test output unit |
| 用户切换 channel | 对方 channel 的 volatile tail 清空 |

### 接口

```
Context Engine
  ├─→ snapshot(phase, channel, options) → ContextSnapshot
  ├─→ warm(file_path)   → void
  ├─→ evict(file_path)  → void
  ├─→ pin(file_path)    → void
  ├─→ getCacheStats()  → CacheStats
  └─→ setChannelConfig(channel, config) → void
```

---

## 5. Permission Engine（权限引擎）

> v1.1.1

### 在调用链中的位置

```
Channel (Think/Act)
  │
  ▼
Tool Resolver          ← 只读查 ToolDefinition
  │
  ▼
Param Normalizer       ← 参数标准化
  │
  ▼
Permission Engine      ← 集中决策点
  │
  ├─ autonomy gating
  ├─ policy matching
  ├─ programmable rules
  ├─ audit logging
  │
  ▼
Tool Executor
```

### 信任层级（优先级高→低）

1. **全局用户策略**（`~/.deepseek-code/permissions.json`）— 最高
2. **已信任项目的 JS 规则**（用户标记 trust 后，JS 可返回 allow）
3. **项目声明式规则**（`.deepseek-code/permissions.json`）
4. **默认策略矩阵**

未信任项目的 JS 规则：**默认不执行**，用户预览源码后选择启用；未信任执行结果 allow 降级为 ask。

### 资源类别

| 类别 | 示例 |
|------|------|
| **read** | read_file, grep, glob, search, git_diff, git_log |
| **read_secret** | .env, .pem, *credentials*, *.key |
| **write_create** | 新建文件，新目录 |
| **write_update** | 修改已有文件（patch/overwrite） |
| **write_delete** | 删除文件，移动/重命名，清空目录 |
| **execute** | shell_cmd, npm_test, npm_build, node script |
| **network** | npm_install, pip_install, api_call |
| **destructive** | git_reset_hard, rm_rf, db_drop |

### 默认策略矩阵

| 自治级别 | read | read_secret | write_create | write_update | write_delete | execute | network | destructive |
|----------|------|-------------|--------------|--------------|--------------|---------|---------|--------------|
| **supervised** | auto | ask | ask | ask | ask | ask | ask | deny |
| **gated** | auto | ask | auto | auto | ask | ask | ask | deny |
| **auto** | auto | ask | auto | auto | auto | auto | ask | deny |
| **full-auto** | auto | ask | auto | auto | auto | auto | auto | deny |

`read_secret`：即使 approve，也走脱敏链路，默认不写入 model persistence。
`destructive`：永远不可自动 allow，full-auto 也需要 explicit approval，某些操作需二次确认。

### Shell 命令：结构化匹配

权限引擎接收标准化结构，不是原始字符串：

```jsonc
{
  "tool": "shell",
  "argv": ["npm", "test"],
  "cwd": "/project/packages/core",
  "env_delta": {},
  "shell": false
}
```

规则匹配优先用 `argv` 精确匹配，不推荐正则字符串 pattern。

Shell 默认约束：
- `shell=false`（不使用 system shell）
- `argv` 模式优先
- cwd 限制在 workspace 内
- timeout 后 kill process tree
- stdout/stderr 分流
- 输出 > 64KB 截断，完整内容存 artifact ref
- 环境变量白名单

### TTL 绑定指纹

```
ttl_key = SHA256(tool + normalized_argv + cwd + resource_pattern + project_id)
```

不是 category 级放行，精确到"具体操作+具体目标+具体项目"。

### "always" 存储策略

- 用户点 "always" → 写入 `~/.deepseek-code/trust.json`（用户级，不进仓库）
- 用户明确选 "保存到项目配置" → 写入 `.deepseek-code/permissions.json`（警告：将进仓库）

### 路径规范化链

```
raw_path → realpath → workspace_boundary_check → normalize
  (Windows drive/case/separator) → glob_expansion → matched_against_rules
```

### 接口

```
Permission Engine
  ├─→ decide(toolCall, context) → Decision
  ├─→ explain(toolCall) → matched_rules + reason
  ├─→ preview(policyFile) → 规则影响分析
  └─→ trustProject(projectId) → void
```

---

## 6. Tool System（工具系统）

> v1.1

### 三层工具架构

```
┌─────────────────────────────────────────────────────┐
│                   Tool Registry（统一注册表）         │
│                                                      │
│  ① Built-in Tools — 核心能力，随内核打包              │
│  ② MCP Tools — 外部 MCP Server，stdio/HTTP           │
│  ③ Plugin Tools — JS/TS 脚本，项目级轻量注册         │
│                                                      │
│  统一接口：ToolDefinition → ToolCall → ToolResult     │
└─────────────────────────────────────────────────────┘
```

### 执行调用链

```
ToolCall Request
  → Tool Resolver 查 ToolDefinition（只读）
  → Param Normalizer 标准化参数
  → Permission Engine 集中决策
  → Tool Executor 执行（builtin / MCP / plugin wrapper）
  → Result Normalizer 格式化 ToolResult
```

### ToolDefinition

```ts
interface ToolDefinition {
  name: string;
  version: string;
  description: string;
  category: ResourceCategory;
  params: JSONSchema;
  side_effect: "none" | "filesystem" | "process" | "network" | "memory";
  risk_level: "low" | "medium" | "high" | "critical";
  output_schema?: JSONSchema;
  streaming?: boolean;
  timeout_ms?: number;
  max_output_bytes?: number;
  permission: { default_decision: Decision };
  source: "builtin" | "mcp" | "plugin";
  plugin_ref?: string;
}
```

### ToolResult

```ts
interface ToolResult {
  id: string;
  status: "success" | "error" | "denied" | "timeout";
  content: ToolContent[];           // [{ type: "text" | "diff" | "code" | "error", ... }]
  artifacts?: ArtifactRef[];        // 大输出/二进制/报告引用
  stdout?: string;
  stderr?: string;
  metadata?: Record<string, unknown>;
  redactions?: RedactionInfo[];
  duration_ms: number;
}
```

### 内置工具清单

| 工具 | side_effect | risk | 默认权限 |
|------|-------------|------|----------|
| read | none | low | auto |
| grep | none | low | auto |
| glob | none | low | auto |
| ls | none | low | auto |
| git (read ops) | none | low | auto |
| web_search | network | medium | ask |
| web_fetch | network | medium | ask |
| write | filesystem | medium | 按矩阵 |
| edit (diff apply) | filesystem | medium | 按矩阵 |
| delete | filesystem | high | ask |
| shell | process | low→critical | 按矩阵 |
| git (write ops) | filesystem | high | ask |
| test | process | low | auto（已识别命令） |
| memory | memory | medium | ask |
| task | process | medium | ask |
| ask_user | none | low | auto |

### Plugin 安全隔离

- **v1**：纯声明式 tool wrapper（方案 A）。plugin 只暴露 `tool` 定义对象（name, description, params schema, category），声明组合哪些 `context.tools.*` 调用序列。**不提供 execute 函数，不执行任何 JS 代码**。plugin 本身只是一个工具注册声明，实际执行全部由内置 Tool Executor 完成，所有调用重新走 Permission Engine。
- **v1.5/v2 扩展**：已信任项目可升级为受限 JS wrapper（capability API 模式）或 child process 隔离执行，用于需要自定义计算逻辑的 plugin。
- 未信任项目：plugin 不加载。

### MCP 集成

```
启动时读取 mcp_servers 列表
  → stdio / HTTP SSE 连接
  → tools/list 发现，注册为 mcp: 前缀工具
  → Server Trust State:
      untrusted → tools/call 默认 ask
      trusted   → 按具体 tool category 走权限链
  → server 更新后 capability_hash 变化 → 提示重新信任
```

### 特殊工具约束

**test**：只对已识别安全命令 auto（npm test, node --test, pytest, cargo test, go test），未知命令走 execute 权限。

**web_fetch**：禁止 localhost/127.0.0.1/0.0.0.0/169.254.*/private LAN/file://。

**memory**：读写持久记忆，存储于 `~/.deepseek-code/projects/<id>/memory/`，不进仓库。

**task（子代理）**：
- parent_trace_id 可追溯
- delegated_tools 非全部工具
- delegated_budget 独立 token 预算
- delegated_autonomy 不超过父级
- 子代理权限决策重新走 Permission Engine

---

## 7. Session Manager（会话管理）

> v1.1

### Append-Only Event Log

```
Session = 一串不可变事件，按时间追加，永不修改
每条事件带 schema_version 和 hash chain（event_id + prev_hash + event_hash）
```

### 事件类型

```
session:start        — 会话启动（mode, cwd, git_commit, config_id）
user:message         — 用户输入
orchestrator:state   — 状态转移（完整 transition schema）
context:snapshot     — 上下文快照引用（不存内容，存引用哈希）
channel:invoke       — 通道调用（think/act, model_config_id）
model:request        — API 请求元信息
model:response       — API 响应（usage, cache_hit, latency, reasoning_tokens）
tool:call            — 工具调用（标准化参数 + 权限决策）
tool:result          — 工具结果（小输出：redacted；大输出：artifact_ref；敏感：只存 metadata）
permission:decision  — 权限决策（脱敏：不记录 secret 内容、完整 env、token）
artifact:store       — artifact 引用（hash + location + TTL）
file:diff            — 文件修改 diff
verification:result  — 验证结果
session:pause        — 会话暂停（界面切换/GUI 关闭）
session:end          — 会话结束（原因、统计摘要）
session:resume       — 恢复续接点
```

### 存储结构

```
~/.deepseek-code/
├── sessions/
│   └── <project_id>/
│       └── <session_id>.jsonl     ← append-only event stream
│
├── projects/
│   └── <project_id>/
│       ├── memory/                 ← 持久记忆（不进仓库）
│       ├── context_cache/          ← snapshot 引用对应的 unit 缓存
│       └── artifacts/              ← 大输出/报告（TTL 管理）
│
├── trust.json                      ← 用户信任存储
├── permissions.json                ← 全局权限
└── config.json                     ← 全局配置
```

### 跨界面切换

```
CLI ↔ TUI ↔ GUI 切换：
  1. 写入 session:pause 事件
  2. Event log 持久化到磁盘
  3. 新界面启动，读取 event log
  4. 写入 session:resume 事件
  5. 继续对话

三者共享同一 session_id，同一份 event log
```

### 恢复策略

| 最后状态 | 恢复行为 |
|----------|---------|
| Complete / Idle / ThinkReply | safe resume |
| AwaitApproval | 恢复确认界面 |
| ActExecute / ToolCall running | 标记 interrupted，询问是否重试 |

温层状态恢复：从 snapshot refs 快速恢复（load unit refs → verify file_revision_hashes → stale unit 降级），非 event replay。

### Artifact 生命周期

- TTL：默认 7 天
- 项目上限：100MB
- 定期清理，hash + trace_id 可追溯

---

## 8. Model Provider（DeepSeek 适配层）

> v1.1 — 基于 DeepSeek 官方 API 文档

### 双通道参数模板

| 参数 | Think 通道 | Act 通道 |
|------|-----------|----------|
| model | reasoning_profile.default（例：deepseek-v4-pro） | fast_profile.default（例：deepseek-v4-flash） |
| thinking | `{"type": "enabled"}` | `{"type": "disabled"}` **（必传）** |
| reasoning_effort | "high" / "max" | 不传 |
| temperature | **不传**（thinking mode 下无效） | 0.1 |
| max_tokens | 16384 | 4096 |
| stream | false（除非模型支持 reasoning+stream） | true |
| response_format | `{"type": "json_object"}`（Think 阶段） | 不设 |

### 模型路由

> 实际模型名通过 `ModelProfile` 配置映射，不硬编码在架构中。以下为出厂默认值，
> DeepSeek API 命名变化时只需更新 profile 配置，架构文档不失效。

```
用户显式指定 → 用指定模型
Think 通道   → reasoning_model（默认 reasoning_profile = v4-pro）
Act 通道     → fast_model（默认 fast_profile = v4-flash）
```

用户可配置三档：
- **省成本**：Think=flash+thinking off, Act=flash
- **均衡（默认）**：Think=pro+thinking on, Act=flash
- **最强**：Think=pro+thinking on+effort=max, Act=pro

### reasoning_content 处理

```
reasoning_content:
  ✗ 不展示给用户
  ✗ 不进入普通 conversation context
  ✗ 不写入可浏览 timeline
  ✓ tool-call turn 内作为 hidden protocol state 保存
  ✓ 后续请求在对应 tool call 位置传回 API（否则可能 400）
  → task 完成后可丢弃或加密归档
```

### FIM 接入

使用 DeepSeek Beta `/completions` 接口：

```jsonc
{
  "model": "fim_profile.default",
  "prompt": "prefix code",
  "suffix": "suffix code",
  "max_tokens": 128        // FIM 最大输出 4K
}
```

- 适用：小范围精修 / 补中间代码
- 限制：non-thinking mode only，4K 上限
- 大范围修改：fallback to unified diff

### 1M 上下文窗口利用

```
不无脑填满。策略：
  Think：上限 500K（用户可配到 1M），为空闲留余量
  Act：上限 64K（repair loop 内可放宽至 128K）
  token budget 由 Context Engine 控制，Model Provider 只负责组装

组装顺序（cache-aware）：
  messages[0]: system prompt（稳定前缀）
  messages[1]: project context（热层 P0-P2）
  messages[2..N-2]: conversation history
  messages[N-1]: current user request
  messages[N]: tool results
```

### JSON Structured Output 防截断

- schema validation
- empty content retry
- truncated JSON repair
- max_tokens guard

### 错误处理

| 错误 | 处理 |
|------|------|
| 400/422 | 检查参数；若 context too long，缩减后重试 1 次 |
| 401/403 | 不重试，立即报告用户 |
| 402 | 余额不足，直接提示 |
| 429 | 等 Retry-After header，最多 2 次退避重试 |
| 500/503 | 指数退避重试（1s, 2s, 4s），最多 3 次 |
| `finish_reason=insufficient_system_resource` | 降低输出/上下文后重试 |

### 用量追踪

```
每次 API 调用记录：
  prompt_tokens / completion_tokens / reasoning_tokens
  observed_cache_hit_tokens / observed_cache_miss_tokens
  latency_ms（首 token / 总耗时）
  model / channel / task_type

会话级累计：
  总 tokens（按 channel/model 分类）
  cache hit rate
  成本估算
```

### 接口

```ts
ModelProvider {
  invoke(messages, channel, options) → ModelResponse
  streamDelta(messages, channel, onDelta, options) → ModelResponse
  supportsFIM() → boolean
  fimComplete(prefix, suffix, options) → string
  getUsageStats(session_id) → UsageStats
}
```

---

## 9. TUI 升级

> v1.1 — 基于 Ink/React

### 面板布局

```
┌──────────────┬──────────────────────────────┬──────────────┐
│  ① 会话面板   │   ② 主输出区                   │  ③ 上下文面板 │
│              │                              │              │
│  时间线视图   │   流式输出/代码/diff            │  文件列表     │
│  · 用户消息   │   · 文本                      │  Pin/Unpin   │
│  · 模型响应   │   · 语法高亮代码               │  token 分布   │
│  · 工具调用   │   · 彩色 diff                 │              │
│  · 状态切换   │                              │              │
│  · diff 预览  │                              │              │
│              │                              │              │
├──────────────┴──────────────────────────────┴──────────────┤
│  ④ 输入栏                                                  │
│  > _                                      Enter提交/Ctrl+J换行│
├────────────────────────────────────────────────────────────┤
│  ⑤ 状态栏                                                  │
│  gated | think | 210K/500K | cache 85% | 12.3K tokens    │
└────────────────────────────────────────────────────────────┘
```

### 技术选择

- **Ink** (React for CLI)：组件化、Flexbox 布局、hooks、测试友好
- Claude Code、Gemini CLI 等同类工具也在使用
- 从当前 readline 实现渐进迁移

### 渐进实施

1. Phase 1：主输出区 + 输入栏 + 状态栏（替换当前单页菜单）
2. Phase 2：会话时间线面板
3. Phase 3：上下文面板
4. Phase 4：diff/approval/context token 可视化

### Responsive 布局

| 终端宽度 | 布局 |
|----------|------|
| ≥120 cols | 三栏 |
| 90-119 cols | 时间线 + 主输出，context 用 Tab 抽屉 |
| <90 cols | 单栏，面板快捷键切换 |

### 内核接口（与 CLI 共用）

```
TUI → Kernel.agent.send(message)
TUI → Kernel.agent.approve(id, decision)
TUI → Kernel.agent.interrupt()
TUI → Kernel.session.subscribe() → event stream
TUI → Kernel.session.getTimeline()
TUI → Kernel.context.getSnapshot()
TUI → Kernel.config.get()
```

TUI 只订阅 Kernel，不直接读写业务状态。

### 快捷键

```
全局：
  Ctrl+Q, q     — 退出
  Ctrl+K        — 命令面板
  Ctrl+R        — 恢复上次会话
  Ctrl+L        — 清屏

输入栏：
  Enter         — 提交消息
  Alt+Enter / Ctrl+J — 换行
  Ctrl+P        — 附加文件引用
  Ctrl+D        — 切换自治级别
  Ctrl+T        — 切换模式

输出区：
  Ctrl+Y        — Yank 复制
  Ctrl+F        — 搜索
  PgUp/PgDn     — 翻页
```

---

## 10. GUI（Electron 桌面应用）

> v1.1 — Progressive Disclosure

### 渐进式三层界面

```
        ┌──────────────────────────────────┐
        │          Surface Layer           │  ← 永远可见
        │         （对话即界面）             │
        ├──────────────────────────────────┤
        │          Context Layer           │  ← Agent 活动时自动展开
        │         （透明可见）               │
        ├──────────────────────────────────┤
        │          Control Layer           │  ← 决策点触发或主动拉下
        │         （完整掌控）               │
        └──────────────────────────────────┘
```

### 三层过渡

```
Surface Layer（默认，零门槛）
  │
  ├─ Agent 开始工作 ──→ 底部滑出 Context Layer（迷你状态条）
  │                        ├─ 用户点击 ──→ Context Layer 展开
  │                        └─ Agent 完成 ──→ 自动收起
  │
  ├─ AwaitApproval / Terminal ──→ 全屏展开 Control Layer
  │                        └─ 用户决策 ──→ 收回
  │
  └─ 用户 Ctrl+↑ ──→ Control Layer 常驻
      用户 Ctrl+↓ ──→ Surface Layer
```

### Control Layer 由 Orchestrator 状态驱动

GUI 不自行判断何时展开，监听：
- `AwaitApproval(plan | execute | review | permission)`
- `Terminal`
- `ThinkReview requires user confirmation`

### Surface Layer 安全原则

涉及写文件、安装依赖、删除、网络访问时，即使 Surface 模式也必须进入确认 UI。不让"简洁体验"削弱权限透明度。

### 用户偏好

```
minimal:  只显示状态条
balanced: 自动展开工具日志
verbose:  展开上下文和 token
```

### Electron 安全边界

```
Renderer（React）:
  nodeIntegration: false
  contextIsolation: true
  IPC schema validation
  只能调用白名单 Kernel API

Main Process（Node.js）:
  Agent Kernel 实例
  HTTP Server（可选，仅 127.0.0.1，随机 token）
```

### UI State Adapter

```
Session Event Log → UI State Adapter → Surface/Context/Control ViewModel
```

Renderer 不直接消费原始 event log。

### 与 CLI/TUI 的关系

```
┌──────────────────────┐
│   Electron App        │
│  ┌────────────────┐  │
│  │  Renderer (UI)  │  │
│  └───────┬────────┘  │
│          │ IPC        │
│  ┌───────▼────────┐  │
│  │  Main Process   │  │
│  │  Kernel Service │  │  ← single writer
│  │  HTTP Server    │  │  ← 可选，CLI/TUI 可 attach
│  └────────────────┘  │
└──────────────────────┘

Kernel 单写原则：
  Kernel Service = single writer of Event Log
  GUI / CLI / TUI = clients
```

---

## 11. 分阶段实施路线

按用户价值 + 风险验证优先级：

```
Phase 0 ─ Kernel 底座（所有阶段的前置依赖）
  ├─ 事件总线（EventBus：模块间松耦合通信）
  ├─ 最小 Session Log（append-only JSONL + event schema + hash chain）
  ├─ Kernel API 定义（agent.send / agent.approve / session.subscribe 等）
  ├─ 配置加载（Config Provider：全局 + 项目 + 环境变量三层合并）
  └─ 产出：CLI/TUI/GUI 可统一调用的内核接口，后续所有模块在此底座上构建

Phase 1 ─ 核心智能（风险最高，价值最大）
  ├─ Model Provider (双通道 + FIM + 用量)
  ├─ Context Engine (三层记忆 + cache-aware)
  ├─ Task Orchestrator (状态机 + 通道路由)
  └─ 验证：1M 上下文实际利用率、thinking 对代码生成提升

Phase 2 ─ 安全与扩展
  ├─ Permission Engine (完整权限系统)
  ├─ Tool System (内置工具 + MCP + Plugin)
  └─ 验证：权限策略可用性、MCP 兼容性

Phase 3 ─ 体验层
  ├─ Session Manager (event log + resume)
  ├─ TUI 升级 (Ink 分面板)
  ├─ CLI 增强
  └─ 验证：CLI/TUI 切换、恢复续接体验

Phase 4 ─ GUI
  ├─ Electron 应用 (渐进三层界面)
  └─ 验证：普通用户可用性

Phase 5 ─ 打磨
  ├─ Web Fetch/FIM/子代理完善
  ├─ 多测试框架集成
  ├─ 配置向导
  └─ 文档与发布
```

---

## 12. Cross-Cutting：Observability（横切关注点）

所有模块共享的追踪能力，不画入主图但在每个模块中嵌入：

| 追踪字段 | 来源/写入点 | 用途 |
|----------|------------|------|
| **trace_id** | Orchestrator 每次状态转移生成 | 串联同一任务的所有事件 |
| **token_usage** | Model Provider 每次 API 调用后记录 | 成本核算、budget 控制 |
| **latency_ms** | Model Provider 记录首 token + 总耗时 | 性能诊断 |
| **cache_hit_rate** | Model Provider 从 API 返回提取 observed_cache_hit/miss_tokens | cache 策略优化 |
| **tool_success_failure** | Tool Executor 执行后写入 ToolResult.status | 工具可用性监控 |
| **permission_deny_reason** | Permission Engine 写入 decision event | 安全审计 |
| **model_retry_count** | Model Provider 重试时递增，写入 model:request event | 可靠性追踪 |

所有追踪数据写入 event log，TUI/GUI 状态栏实时展示核心指标（当前 tokens、cache%、通道）。
