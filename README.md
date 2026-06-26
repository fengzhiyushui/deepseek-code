# DeepSeek Code

**简体中文** · [English](./README.en.md)

![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![deps](https://img.shields.io/badge/core%20runtime%20deps-0-success.svg)

> 面向 DeepSeek 的本地 AI 编程 Agent —— **CLI · TUI · 桌面 GUI**,统一构建在同一个 V2 内核之上。

DeepSeek Code 在你的项目目录里运行,读代码、改代码、跑测试,并把每一步模型调用、工具执行、文件改动和审批都记录成可回放的会话时间线。它直连 DeepSeek 模型,核心 CLI **无必需运行时依赖**(纯 Node 标准库),只需 Node ≥ 20 和一个 API Key 即可使用。

> ⚠️ **声明**:本项目为**非官方**第三方开源项目。"DeepSeek" 为其所有者的商标,本项目仅在描述"适配该模型"的意义上使用该名称。

---

## ✨ 特性

- **统一内核** —— CLI / TUI / GUI 共用一个 V2 Kernel:一个 Agent runtime、一条工具执行路径、一套编辑/回滚服务、一条会话时间线。
- **事务化编辑与回滚** —— 改文件前建快照,失败可回滚;每次变更都有 change id,可 `changes` 查看、`rollback` 撤销。
- **验证-修复闭环** —— 应用变更后自动验证,必要时进入修复回合。
- **上下文引擎** —— 项目文件按相关度分层 + token 预算 + 快照缓存,把对的代码喂给模型。
- **分支与时间旅行** —— 会话可从任意 turn 分叉(branch),也可 rewind 回到历史状态。
- **持久化恢复(可选)** —— 进程崩溃后凭项目锁 + 暂停 sidecar + 事务日志恢复未完成的回合;**默认关闭**,opt-in 开启。
- **运行护栏** —— 工具/模型调用超时默认 120s 开启;token、模型调用次数、畸形 tool-call 重试均可配额;命中后**优雅停止**而非崩溃。
- **DeepSeek 原生适配** —— 按用途路由模型(reply/act/plan/review/repair/fim)、JSON mode guard、SSE 流式、FIM 代码补全、用量遥测。
- **安全基线** —— workspace 边界 realpath 校验、shell 结构化 argv、web_fetch SSRF 防护、密钥脱敏、GUI 沙箱化。

---

## 🚀 快速开始

**前置条件**:Node.js ≥ 20。

```bash
git clone <your-repo-url> deepseek-code
cd deepseek-code
# 核心 CLI 无必需依赖,无需 npm install 即可运行

# 配置 DeepSeek API Key(二选一)
node ./bin/deepseek-code.js config init --api-key sk-xxxx   # 写入 .deepseek-code/config.json
# 或使用环境变量:
#   bash/zsh   : export DEEPSEEK_API_KEY="sk-xxxx"
#   PowerShell : $env:DEEPSEEK_API_KEY="sk-xxxx"
#   CMD        : set DEEPSEEK_API_KEY=sk-xxxx

# 跑起来
node ./bin/deepseek-code.js help
node ./bin/deepseek-code.js ask "解释这个项目的架构"
node ./bin/deepseek-code.js edit "修复 README 里的拼写问题" --dry-run
node ./bin/deepseek-code.js edit "修复 README 里的拼写问题" --yes
node ./bin/deepseek-code.js tui
```

> 全局安装后可用 `deepseek-code` / `dsc` 短命令(`package.json` 的 `bin`):`npm link` 或 `npm i -g .`。

---

## 🧭 命令一览

| 命令 | 作用 |
|------|------|
| `ask "<问题>"` | 基于项目上下文提问 |
| `chat [问题]` | 连续对话;默认只读,会话内 `/mode` 可切 `gated` / `auto` |
| `edit "<需求>"` | 生成补丁并经编辑服务应用;`--dry-run` 仅预览、`--yes` 跳过确认、`--file <路径>` 指定相关文件(可重复) |
| `test [命令...]` | 运行**项目自身**的测试并透传真实退出码 |
| `tui` | 打开交互式终端界面 |
| `scan` | 扫描并打印项目上下文索引 |
| `search "<关键词>"` | 搜索项目代码(`--max` 控制条数,默认 80) |
| `diff` | 查看 Git 差异 |
| `config show \| init \| test` | 查看生效配置 / 写入本地配置 / 测试 API 连接 |
| `changes list \| show [id\|latest]` | 查看变更记录与详情(`--limit`) |
| `rollback [id\|latest]` | 回退指定变更 |
| `resume` | 查看最近会话记录 |

> 注意:`deepseek-code test` 跑的是**你的项目**的测试;`npm test` 跑的是 DeepSeek Code 自身的测试套件。

---

## ⚙️ 配置

**配置文件**(均含 API Key,已被 `.gitignore` 忽略,不会进仓库):

- 项目级 `./.deepseek-code/config.json`(优先)
- 用户级 `~/.deepseek-code/config.json`(回退)

**环境变量**(优先级高于配置文件中的对应项):

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | — | 配置文件无 `apiKey` 时使用 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 基址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 默认对话模型 |
| `DEEPSEEK_REASONING_EFFORT` | `high` | 推理强度 |
| `DEEPSEEK_TOOL_TIMEOUT_MS` | `120000` | 工具调用超时覆盖 |
| `DEEPSEEK_MODEL_TIMEOUT_MS` | `120000` | 模型调用超时覆盖 |

**运行护栏 `limits`**(写在 `config.json` 的 `limits` 块,`config show` 可见):

| 参数 | 默认 | 含义 |
|------|------|------|
| `toolTimeoutMs` | `120000`(开) | 单次工具调用超时;超时落为 `status:"error"`,不强杀进程 |
| `modelTimeoutMs` | `120000`(开) | 单次模型调用超时(工具循环 / 审批 resume / 修复三路径均覆盖) |
| `maxTurnTokens` | `null`(关) | 单个 turn 的 token 上限;命中后**优雅停止** |
| `maxModelCalls` | `null`(关) | 单个 turn 的模型调用次数上限 |
| `maxToolCallRepairs` | `null`(关) | 模型吐出畸形 tool-call 时的有界重试次数 |

> **配置哲学:在适配 DeepSeek 的前提下,参数尽量交给用户。** 默认值只给"安全合理的起点",不锁死;`null` 或 `≤0` 表示关闭对应护栏。完整说明见 [`docs/project-overview.md`](docs/project-overview.md#7-运行护栏与配置)。

---

## 🖥️ 桌面 GUI

GUI 是基于 Electron 的工作台(分支 / rewind 可视化、审批流、用量统计):

```bash
cd gui
npm install
npm start        # 开发模式:npm run dev
```

---

## 🏗️ 架构一览

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

内置工具:文件 `read` `ls` `grep` `glob` · 编辑 `diff_preview` `diff_apply` `diff_rollback` `edit` · 进程 `shell` `test` `git` · 网络 `web_fetch` · 记忆 `memory` · 协作 `task` `ask_user`。

> 架构、工具执行顺序、编辑/回滚、持久化恢复、安全不变量、会话事件全集与目录地图,详见 **[`docs/project-overview.md`](docs/project-overview.md)**。

---

## 🔐 安全

- 文件路径以 realpath 校验 workspace 边界,阻断 symlink 逃逸。
- 工具 category 只信任注册表定义;destructive 操作永不被 trust rule 自动放行。
- `shell` 只接受结构化 argv 并以 `shell:false` 执行。
- `web_fetch` 阻断 localhost / 私网 / link-local / IPv4-mapped IPv6 / IPv6 literal,且每跳 redirect 后重新校验。
- 输出中的密钥会被脱敏;GUI 采用 `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` + IPC 白名单。

---

## 🧪 开发

```bash
npm test            # node --test:运行 test/ 与 tests/ 下的全部用例
npm run check       # node --check:对全部源码做语法校验
git diff --check    # 检查行尾 / 冲突标记
```

文档维护顺序(代码 → specs/plans → project-overview → CHANGELOG → README 中+英 → 索引)与规范见 [`docs/README.md`](docs/README.md#文档维护规范与更新顺序)。

---

## 📚 文档

- **[`docs/project-overview.md`](docs/project-overview.md)** —— 项目深入说明(架构 / 工具 / 编辑 / 恢复 / 安全 / 事件 / 目录)。
- [`docs/README.md`](docs/README.md) —— 文档中心:索引 + 维护规范。
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) —— 版本里程碑(当前主线 V2 已收尾,V3 路线图规划中)。
- `docs/specs/` · `docs/plans/` —— 设计文档与实施计划(按 architecture / backend / frontend 划分)。

---

## 📄 许可证

[Apache-2.0](LICENSE)。
