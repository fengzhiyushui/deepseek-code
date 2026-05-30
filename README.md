# deepseek-code

<p align="center">
  <strong>DeepSeek 专属本地编程助手</strong><br>
  基于 DeepSeek V4 的 Agent Loop · 双通道推理 · 1M 上下文 · 可编程权限
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0-blue" alt="version">
  <img src="https://img.shields.io/badge/tests-129%20passing-green" alt="tests">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="node">
  <img src="https://img.shields.io/badge/model-deepseek--v4-orange" alt="model">
</p>

---

## 目录

- [简介](#简介)
- [安装与环境配置](#安装与环境配置)
  - [前提条件](#前提条件)
  - [获取 DeepSeek API Key](#获取-deepseek-api-key)
  - [配置项目](#配置项目)
- [快速上手](#快速上手)
  - [第 1 步：提问](#第-1-步提问)
  - [第 2 步：连续对话](#第-2-步连续对话)
  - [第 3 步：让 AI 改代码](#第-3-步让-ai-改代码)
  - [第 4 步：TUI 交互界面](#第-4-步tui-交互界面)
  - [第 5 步：GUI 桌面应用](#第-5-步gui-桌面应用)
- [命令参考](#命令参考)
- [配置指南](#配置指南)
  - [模型选择](#模型选择)
  - [双通道推理](#双通道推理)
  - [环境变量](#环境变量)
- [架构概览](#架构概览)
- [自治级别](#自治级别)
- [权限系统](#权限系统)
- [工具系统](#工具系统)
- [设计边界](#设计边界)

---

## 简介

**deepseek-code** 是一个从零构建的 DeepSeek 专属本地编程助手（CLI + TUI + GUI）。不是 wrapper，不是 shell script — 它是一个完整的 Agent 内核。

**它能做什么：**

- 🔍 扫描你的项目，理解代码结构
- 💬 基于项目上下文回答技术问题
- ✏️ 生成 unified diff 补丁，确认后自动应用
- 🔄 Agent Loop：自动"读文件 → 搜索 → 改代码 → 跑测试 → 修复"
- 🧠 双通道推理：Think 通道做深度分析（thinking enabled），Act 通道做快速执行
- 🛡️ 权限系统：8×4 矩阵 + 可编程规则 + TTL 指纹授权
- 🔧 16 个内置工具（read/write/shell/web_fetch/memory）
- 🖥️ 三种界面：CLI 命令行 + TUI 终端界面 + GUI 桌面应用

---

## 安装与环境配置

### 前提条件

- **Node.js >= 20**（ES modules）
- **DeepSeek API Key**（[platform.deepseek.com](https://platform.deepseek.com) 注册获取）
- Windows / macOS / Linux
- Git（可选，用于 `diff` 命令）

### 获取 DeepSeek API Key

1. 访问 [platform.deepseek.com](https://platform.deepseek.com)
2. 注册账号，进入 API Keys 页面
3. 创建一个新的 API Key，形如 `sk-xxxxxxxxxxxxxxxx`
4. 确保账户有余额（DeepSeek 按 token 计费）

### 配置项目

```bash
# 克隆项目（或直接使用本地目录）
cd deepseek-code

# 方式 1：写入项目本地配置（推荐）
node bin/deepseek-code.js config init --api-key sk-xxxxxxxxxxxxxxxx

# 方式 2：使用环境变量（不写文件）
# Windows CMD:
set DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
# PowerShell:
$env:DEEPSEEK_API_KEY="sk-xxxxxxxxxxxxxxxx"
# macOS / Linux:
export DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx

# 测试连接是否成功
node bin/deepseek-code.js config test
# 输出：DeepSeek API 连接测试通过。
```

**配置存储位置：**
- 项目本地：`.deepseek-code/config.json`（优先级高于全局）
- 全局：`~/.deepseek-code/config.json`
- 环境变量：`DEEPSEEK_*` 系列（优先级最高）

**配置合并规则：** 环境变量 > 项目本地文件 > 全局文件 > 默认值

---

## 快速上手

### 第 1 步：提问

最简单的用法 — 向 DeepSeek 提问，它会基于整个项目上下文回答：

```bash
# 解释项目结构
node bin/deepseek-code.js ask "这个项目是做什么的？主要模块有哪些？"

# 分析某个文件
node bin/deepseek-code.js ask "src/cli.js 里的 parseArgs 函数有什么边界问题？"

# 查找特定模式
node bin/deepseek-code.js ask "项目中哪些地方使用了硬编码的配置值？"
```

**原理：** `ask` 命令会扫描项目文件，构建上下文，通过 **Think 通道**（thinking=enabled, deepseek-v4-pro）发送给 DeepSeek 分析，然后返回结构化答案。

### 第 2 步：连续对话

`chat` 命令开启 REPL 模式，保留对话历史，适合多轮探索：

```bash
node bin/deepseek-code.js chat
```

```
连续对话
输入 /exit 退出，/clear 清空上下文，/history 查看轮数。

你 > 这个项目的权限系统是怎么设计的？
DeepSeek > 权限系统分为 8 个资源类别...

你 > 如果我想添加一个新的权限类别呢？
DeepSeek > 你需要在 permission-engine.js 的 RESOURCE_CATEGORIES 中添加...

你 > /clear
已清空对话上下文。

你 > 帮我看看 src/tui.js 的结构
DeepSeek > src/tui.js 是交互式终端界面...
```

**对话历史**：保存在 `.deepseek-code/chat.json`（最近 30 轮），用 `--reset` 重新开始。

### 第 3 步：让 AI 改代码

`edit` 命令是最核心的功能 — 描述需求，DeepSeek 生成 unified diff，你确认后自动应用：

```bash
# 指定要修改的文件
node bin/deepseek-code.js edit "修复 parseArgs 中空字符串参数的处理" --file src/cli.js

# 预览补丁但不应用
node bin/deepseek-code.js edit "给所有函数添加 JSDoc" --file src/agent.js --dry-run

# 跳过确认直接应用（谨慎使用）
node bin/deepseek-code.js edit "修复 typo" --file README.md --yes
```

**工作流程：**

1. 扫描项目上下文 + 读取指定文件
2. Think 通道分析 → 生成结构化 plan
3. Act 通道执行 → 生成 unified diff
4. **展示补丁预览**，列出涉及文件
5. 等待确认 `[y/是/N]`
6. 应用补丁 → 保存快照 → 返回变更 ID

**回退修改：**
```bash
# 查看记录
node bin/deepseek-code.js changes list
# 查看最近补丁详情
node bin/deepseek-code.js changes show latest
# 回退最近修改
node bin/deepseek-code.js rollback latest
```

每次修改前自动保存文件快照到 `.deepseek-code/changes/<id>.json`，回退时用快照恢复。

### 第 4 步：TUI 交互界面

TUI 是全屏终端交互界面，方向键操作，比 CLI 更方便：

```bash
node bin/deepseek-code.js tui
```

```
DeepSeek Code 0.1.0
DeepSeek 专属本地编程助手

项目根目录    /home/user/my-project
当前模式      交互模式
操作提示      方向键选择，回车执行，q 退出

功能选项
> 向 DeepSeek 提问           基于当前项目上下文回答问题
  连续对话                   保留上下文进行多轮交流
  生成补丁修改               生成 diff，确认后再写入文件
  搜索项目代码               在当前项目里查找关键词
  扫描项目上下文             查看已索引的项目文件
  运行测试                   运行 node --test
  查看 Git 差异              显示当前仓库改动
  查看修改记录               查看最近的补丁详情
  回退最近修改               恢复最近一次已记录的修改
  配置 API 密钥              写入 DeepSeek 密钥、模型和接口地址
  测试 API 连接              验证当前 DeepSeek 配置是否可用
  退出                       离开终端界面

│ gated │ think │ 45.2K tokens │ cache 87% │
── Recent Activity ──
14:32:01 💬 修复 parseArgs 的边界条件
14:32:03 🔄 classify → thinkplan
14:32:05 🔄 thinkplan → actexecute
```

底部状态栏实时显示：自治级别、当前通道、token 用量、cache 命中率。最近事件时间线追踪 Agent 活动。

### 第 5 步：GUI 桌面应用

Electron 桌面应用，零门槛，适合普通用户：

```bash
cd gui
npm install
npm start
```

**三层渐进界面：**

- **Surface（默认）** — 聊天框 + 输入栏，像 ChatGPT 桌面端一样简单。Agent 自动在后台工作。
- **Context（自动展开）** — 当 Agent 读文件、搜索、改代码时，底部自动滑出活动日志。用户看到 Agent 在做什么，但不需参与决策。
- **Control（决策时全屏）** — 当需要确认计划或权限时，全屏展开面板：执行计划预览、风险提示、文件列表、同意/拒绝按钮。

**安全特性：** `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、CSP 限制、IPC 白名单。用户内容使用 `textContent`（零 innerHTML），XSS 安全。

---

## 命令参考

```text
┌─────────────────────────────────────────────────────────────────┐
│ 基础命令                                                         │
├─────────────────────────────────────────────────────────────────┤
│ tui                    打开交互式终端界面（状态栏 + 时间线）       │
│ ask "问题"             基于项目上下文提问（Think 通道）            │
│ chat [问题] [--reset]  连续对话（REPL，保留上下文）               │
│ edit "需求"            生成补丁，确认后应用                       │
│   --file <path>        指定相关文件（可多次）                     │
│   --dry-run            仅预览补丁，不写入                         │
│   --yes                跳过确认直接应用                           │
├─────────────────────────────────────────────────────────────────┤
│ 项目探索                                                         │
├─────────────────────────────────────────────────────────────────┤
│ scan                   扫描项目文件并打印索引                     │
│ search "关键词"        搜索代码（ripgrep 优先，Node 回退）         │
│   --max <n>            最大结果数（默认 80）                      │
│ test [command...]      运行测试（自动检测框架）                   │
│ diff                   查看当前 Git diff                         │
├─────────────────────────────────────────────────────────────────┤
│ 配置管理                                                         │
├─────────────────────────────────────────────────────────────────┤
│ config init            写入本地配置                               │
│   --api-key <key>      DeepSeek API 密钥                         │
│   --model <name>       默认模型名                                 │
│   --thinking           启用 thinking 模式                         │
│   --reasoning-effort   推理强度（minimal/high/max）               │
│   --base-url <url>     自定义 API 地址                            │
│ config show            查看当前配置（密钥脱敏）                   │
│ config test            测试 API 连接                              │
├─────────────────────────────────────────────────────────────────┤
│ 修改追踪                                                         │
├─────────────────────────────────────────────────────────────────┤
│ changes list           列出修改记录（最近 20 条）                 │
│   --limit <n>          限制数量                                   │
│ changes show latest    查看最近补丁详情                           │
│ rollback latest        回退最近修改（快照恢复）                   │
├─────────────────────────────────────────────────────────────────┤
│ 会话                                                            │
├─────────────────────────────────────────────────────────────────┤
│ resume                 查看最近 10 条会话日志                     │
│ help                   打印帮助信息                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 配置指南

### 模型选择

| 模式 | Think 通道 | Act 通道 | 适用场景 |
|------|-----------|----------|----------|
| **省成本** | flash + thinking off | flash | 简单问答、单文件修改 |
| **均衡**（默认） | pro + thinking on | flash | 日常开发 |
| **最强** | pro + thinking on + effort=max | pro | 复杂重构、代码审查 |

```bash
# 均衡模式
node bin/deepseek-code.js config init --api-key sk-xxx --model deepseek-v4-flash

# 最强模式
node bin/deepseek-code.js config init --api-key sk-xxx --model deepseek-v4-pro --reasoning-effort max --thinking
```

### 双通道推理

```
用户请求
    │
    ▼
Task Orchestrator 分类
    │
    ├── 分析/规划/审查 ──▶ Think 通道
    │   • model: deepseek-v4-pro (可配)
    │   • thinking: enabled
    │   • reasoning_effort: high / max
    │   • context: 最大 500K tokens
    │   • 产出: 结构化 plan / risks / targets
    │
    └── 执行/生成/测试 ──▶ Act 通道
        • model: deepseek-v4-flash (可配)
        • thinking: disabled
        • temperature: 0.1
        • context: 最大 64K tokens
        • 产出: unified diff / code / tool_calls
```

**FIM（Fill-in-the-Middle）：** 通过 `/completions` 接口支持小范围精修（4K 上限，non-thinking mode）。大范围修改自动回退到 unified diff。

### 环境变量

```bash
# 全部支持的环境变量（优先级高于配置文件）
DEEPSEEK_API_KEY=sk-xxx          # API 密钥
DEEPSEEK_MODEL=deepseek-v4-pro   # 默认模型
DEEPSEEK_BASE_URL=https://api.deepseek.com  # API 地址
DEEPSEEK_REASONING_EFFORT=max    # 推理强度（minimal/low/medium/high/max）
```

---

## 架构概览

```
┌──────────────────────────────────────────────────┐
│                  界面层                            │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ CLI REPL │  │ TUI (readline)│  │ GUI (Electron)│ │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘  │
│       └───────────────┼────────────────┘         │
│                       │ Kernel API                │
├───────────────────────┼──────────────────────────┤
│                Agent Kernel                        │
│  ┌─────────────────────────────────────────────┐  │
│  │         Task Orchestrator                    │  │
│  │  Idle→Classify→ThinkPlan→ActExecute→        │  │
│  │  ThinkReview→Verify→Complete                │  │
│  ├──────────────────┬──────────────────────────┤  │
│  │   Think Channel   │     Act Channel          │  │
│  ├──────────────────┴──────────────────────────┤  │
│  │  Context Engine · Permission Engine         │  │
│  │  Tool Registry  · Session Manager           │  │
│  │  Model Provider · Config Provider           │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

**10 个内核模块，129 个测试，0 依赖（除 Node.js 标准库）。**

```
src/kernel/
├── event-bus.js            — 事件总线
├── session-log.js          — JSONL 追加日志 + hash chain
├── session-manager.js      — 事件持久化桥接
├── config-provider.js      — 三层配置合并 + ModelProfile
├── kernel-api.js           — 内核统一入口
├── model-provider.js       — Think/Act 双通道 + FIM
├── context-engine.js       — 冷/温/热三层上下文 + P0-P4
├── task-orchestrator.js    — 11 状态机 + 4 级自治
├── permission-engine.js    — 8×4 矩阵 + TTL 指纹
└── tool-registry.js        — 16 工具 + resolveCategory
```

---

## 自治级别

| 级别 | Plan 确认 | Execute 确认 | Review 确认 | 默认适用 |
|------|-----------|-------------|-------------|----------|
| **supervised** | 必须 | 每步 | 必须 | destructive/network 任务 |
| **gated** | 必须 | 自动 | 必须 | write/edit 任务（默认） |
| **auto** | 自动 | 自动 | 必须 | read/query 任务 |
| **full-auto** | 自动 | 自动 | 自动 | 用户显式 `--auto` |

**Fast Paths：** 纯查询/解释任务（如 "这个项目是做什么的"）跳过 ThinkPlan，直接进入 ThinkReply，减少延迟。

---

## 权限系统

**8 类资源 × 4 级自治 = 32 项默认矩阵。**

| 类别 | 示例 | supervised | gated | auto | full-auto |
|------|------|-----------|-------|------|-----------|
| **read** | 读文件、搜索 | allow | allow | allow | allow |
| **read_secret** | .env、密钥 | ask | ask | ask | ask |
| **write_create** | 新建文件 | ask | allow | allow | allow |
| **write_update** | 修改文件 | ask | allow | allow | allow |
| **write_delete** | 删除文件 | ask | ask | allow | allow |
| **execute** | 运行命令 | ask | ask | allow | allow |
| **network** | 网络请求 | ask | ask | ask | allow |
| **destructive** | rm -rf、reset | deny | deny | deny | deny |

**信任层级**：全局用户策略 > 项目 JS 规则（需信任）> 项目声明式规则 > 默认矩阵

**destructive 硬编码**：不可被任何 trust rule 覆盖。`read_secret` 即使 approve 也走脱敏。

**Shell 命令**：仅接受结构化 `{ argv: ["npm", "test"], cwd, shell: false }`，拒绝原始 cmd 字符串。TTL 授权绑定 SHA256(tool + argv + cwd + resource + projectId) 指纹。

---

## 工具系统

| 工具 | 类别 | 风险 | 说明 |
|------|------|------|------|
| `read` | read | low | 读取文件（realpath workspace 约束） |
| `write` | write_update | medium | 创建/覆写文件 |
| `edit` | write_update | medium | 应用 unified diff 补丁 |
| `delete` | write_delete | high | 删除文件或目录 |
| `grep` | read | low | 正则搜索文件内容 |
| `glob` | read | low | 文件模式匹配 |
| `ls` | read | low | 列出目录内容 |
| `shell` | execute | medium | 执行命令（仅 argv） |
| `test` | execute | low | 运行测试（自动检测框架） |
| `git_read` | read | low | Git 只读（status/diff/log/show/blame） |
| `git_write` | write_update | high | Git 写操作（commit/branch/tag） |
| `web_search` | network | medium | 网络搜索 |
| `web_fetch` | network | medium | 获取 URL（SSRF：环回/私网/DNS rebinding 防护） |
| `ask_user` | read | low | 向用户提问 |
| `memory` | read/write | medium | 跨会话持久记忆（动态类别映射） |
| `task` | execute | medium | 子任务委托（约束工具集） |

**执行流程**：`ToolCall → Tool Resolver → Param Normalizer → Permission Engine → Tool Executor → ToolResult`

`web_fetch` SSRF 防护：阻止 localhost / 127.0.0.0/8 / 169.254.0.0/16 / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 / IPv6 loopback / IPv4-mapped IPv6。重定向逐跳校验。DNS 解析后验证 IP。

`memory` 按 action 动态映射：read/list→read、write→write_update、delete→write_delete。

---

## 设计边界

| 边界 | 说明 |
|------|------|
| 路径安全 | 所有文件操作经 `realpath` 解析符号链接 + `path.relative` 越界检查 |
| Shell 安全 | 仅接受结构化 `argv`，拒绝原始 cmd 字符串 |
| 工具分类不可伪造 | 权限检查使用注册定义的 `category/risk_level/side_effect`，调用方不可覆盖 |
| destructive | 硬编码不可自动允许，trust rules 无法绕过 |
| reasoning 隐私 | 模型推理内容（reasoning_content）不暴露给用户，不持久化到 timeline |
| Agent 不可重入 | `submit()` 在非 Idle/Terminal 状态时抛 BUSY，防状态冲突 |
| 事件持久化 | append-only JSONL + schema v1 + SHA-256 hash chain + 损坏行自动恢复 |
| 配置分层 | 环境变量 > 项目本地 `.deepseek-code/` > 全局 `~/.deepseek-code/` |
| 测试框架检测 | 自动识别：npm test → pytest → cargo test → go test ./... → node --test |
| Session 隔离 | 每个项目独立 session，存储在 `~/.deepseek-code/sessions/<project_id>/` |
