# Inkstone

**简体中文** · [English](./README.en.md)

![version](https://img.shields.io/badge/version-v1.0.0-blue.svg)
![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![deps](https://img.shields.io/badge/core%20runtime%20deps-0-success.svg)

> 面向 DeepSeek 的本地 AI 编程 Agent —— **CLI · TUI · 桌面 GUI**,统一构建在同一个内核之上。

Inkstone 在你的项目目录里运行:它读代码、改代码、跑测试,每一步模型调用、工具执行、文件改动和审批都记录成可回放、可分支、可回退的会话时间线。它直连 DeepSeek 模型,**核心运行时零依赖**,Node ≥ 20 配一个 API Key 即可用。

> ⚠️ **声明**:本项目为**非官方**第三方开源项目。"DeepSeek" 为其所有者商标,本项目仅在描述"适配该模型"的意义上使用该名称。

---

## ✨ 特性

### 统一内核,三端共享

CLI、TUI、桌面 GUI 共用**同一个内核门面** `createKernel()`:一个 Agent runtime、一条工具执行路径、一套编辑/回滚服务、一条会话时间线。三端只做输入、展示与审批,不碰 agent 业务逻辑。

- **事务化编辑与回滚** —— 改文件前建快照,失败可回滚;每次变更有 change id,可 `changes` 查看、`rollback` 撤销。
- **验证-修复闭环** —— 变更应用后自动验证,必要时进入修复回合。
- **分支与时间旅行** —— 会话从任意 turn 分叉(branch),或 rewind 回到历史状态。
- **运行护栏** —— 工具 / 模型调用超时(token / 调用次数 / 畸形重试均可配额),命中后优雅停止。
- **持久化恢复**(opt-in) —— 进程崩溃后凭项目锁 + 事务日志 + 暂停 sidecar 恢复未完成回合;编排回合的审批暂停可**跨进程**续跑。

### 支柱① 上下文引擎 —— 把对的代码喂给模型

- **文件级**(默认):增量扫描 + manifest 缓存 + 路径优先级分层 + 按通道 token 预算贪心装填 + 快照缓存。
- **语义级**(可选,`--semantic-context`):基于 web-tree-sitter(WASM,无原生构建)按**符号**(函数/类)检索,沿 import/调用依赖图扩展;**支持 JS / TS / Python**;`--include-method-hints` 开方法消歧。关闭时与文件级逐字节一致。默认关,opt-in。

### 支柱② 多智能体调度 —— 复杂任务自动拆解

**一次 `send`,内核自动决定走单 agent 还是多 agent**,简单任务零开销。

- **分层路由器**(默认开):明显档免费启发式直判,模糊档才调一次便宜模型(`router.model.enabled=false` 可退回纯启发式)。
- **编排闭环**:Planner 拆子任务 → Worker 执行 → **两级独立审核**(子自审 + 只读 Reviewer)→ Synthesizer 合成;失败 / 不完整多回合自适应重规划;成本闸常开。
- **并行写隔离**:无依赖且文件不重叠的子任务在 fs 拷贝隔离区并行、改完原子合并回主区。
- **跨任务经验记忆**(`crossTaskLearning`,默认 off):次 agent 在任务边界提炼教训存入独立经验库(三级分化 + Jaccard 去重),新任务自动检索注入拆派;风险经验单调升级权限(只升不降)。
- **持久化恢复**(`recovery.enabled`,默认关):含**跨进程编排级** durable 恢复。

### 支柱③ 前端三端 —— 同一个内核,三种交互

**桌面 GUI**(Electron + React + Vite,**原创手写 VS Code 风格**,不用成品 UI 套件;双语 zh/en 默认中文):真文件树 · Monaco 编辑器(本地 worker)· node-pty 交互终端 · 设置页(多 API 管理 / 在线拉模型 / 编辑保存走事务式 editService / 分支切换 / 检查点 rewind)· **agent 改动跟踪**(SCM「AGENT 改动」分区 → 修改前 vs 修改后对比 → hunk 跳转源码)。渲染层沙箱化,密钥掩码不过 IPC。

**终端 TUI**(claude code 式行内滚动流):历史进终端原生滚动区(滚轮/复制/搜索原生可用),底部固定输入 + 状态栏;流式打字机预览 · 工具/diff/审批/编排卡片 · slash 命令补全(`/help /config /diff /changes /mode /lang /clear /recovery /quit`)· `/config` 与 GUI 共享同份 API 列表(激活重建内核保上下文);手写 ANSI/VT,**中英双语默认中文**。

**CLI**:`ask / chat / edit / test / scan / search / diff / config / changes / rollback / tui` 子命令;chat REPL 含 `/mode` `/recovery`(resume/cancel/clear);多 agent 编排摘要行;`/recovery` 与 TUI 对齐。

### DeepSeek 原生适配

按用途路由模型(reply / act → flash;plan / review / repair → pro 开 thinking;fim 走 `/beta/completions`)、JSON mode guard、手写 SSE 流式、FIM 代码补全、tool-call 容错修复、按通道 / 模型聚合的用量遥测。

---

## 🚀 快速开始

**前置条件**:Node.js ≥ 20。

```bash
git clone <your-repo-url> inkstone
cd inkstone
# 核心 CLI 无必需依赖,无需 npm install 即可运行

# 配置 API Key(二选一)
node ./bin/inkstone.js config init --api-key sk-xxxx   # 写入 .deepseek-code/config.json
# 或 export DEEPSEEK_API_KEY="sk-xxxx"                     # 环境变量(bash/zsh)

# 跑起来
node ./bin/inkstone.js help
node ./bin/inkstone.js ask "解释这个项目的架构"
node ./bin/inkstone.js edit "修复 README 里的拼写问题" --dry-run
node ./bin/inkstone.js edit "修复 README 里的拼写问题" --yes
node ./bin/inkstone.js tui
```

> 全局安装后可用 `inkstone` / `dsc` 短命令:`npm link` 或 `npm i -g .`。

---

## 🧭 命令一览

| 命令 | 作用 |
|------|------|
| `ask "<问题>"` | 基于项目上下文提问(`--semantic-context` / `--autonomy` 可选) |
| `chat [问题]` | 连续对话;默认只读,`/mode` 切 `gated` / `auto`;`/recovery` 管理恢复项 |
| `edit "<需求>"` | 生成补丁并应用;`--dry-run` 仅预览、`--yes` 跳过确认、`--file <路径>` 指定相关文件(可重复) |
| `test [命令...]` | 运行**你的项目**的测试并透传退出码 |
| `tui` | 打开 agent 会话式终端界面 |
| `scan` | 扫描并打印项目上下文索引 |
| `search "<关键词>"` | 搜索项目代码(`--max` 控制条数,默认 80) |
| `diff` | 查看 Git 差异 |
| `config show \| init \| test` | 查看生效配置 / 写入本地配置 / 测试 API 连接 |
| `changes list \| show [id\|latest]` | 查看变更记录与详情(`--limit`) |
| `rollback [id\|latest]` | 回退指定变更 |

> `ask` / `chat` / `edit` 支持 `--semantic-context` / `--include-method-hints`(语义上下文)、`--no-stream` / `--max-files` / `--max-bytes`。
> `inkstone test` 跑的是**你项目**的测试;`npm test` 跑的是 Inkstone 自身的测试套件。

---

## ⚙️ 配置

**配置文件**(含 API Key,被 `.gitignore` 忽略,不进仓库):项目级 `./.deepseek-code/config.json`(优先),回退用户级 `~/.deepseek-code/config.json`。

**主要环境变量**(优先级高于配置文件):

| 变量 | 默认 | 说明 |
|------|------|------|
| `DEEPSEEK_API_KEY` | — | 配置文件无 `apiKey` 时使用 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 基址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 默认对话模型 |
| `DEEPSEEK_REASONING_EFFORT` | `high` | 推理强度 |
| `DEEPSEEK_TOOL_TIMEOUT_MS` | `120000` | 工具调用超时覆盖 |
| `DEEPSEEK_MODEL_TIMEOUT_MS` | `120000` | 模型调用超时覆盖 |

**运行护栏 `limits`**(写在 `config.json` 的 `limits` 块):

| 参数 | 默认 | 含义 |
|------|------|------|
| `toolTimeoutMs` | `120000`(开) | 单次工具调用超时,落为 error 而不强杀 |
| `modelTimeoutMs` | `120000`(开) | 单次模型调用超时(工具循环 / 审批 / 修复三路径覆盖) |
| `maxTurnTokens` | `null`(关) | 单 turn token 上限,命中优雅停止 |
| `maxModelCalls` | `null`(关) | 单 turn 模型调用次数上限 |
| `maxToolCallRepairs` | `null`(关) | 畸形 tool-call 有界重试次数 |

> `null` 或 `≤0` 表示关闭。完整说明见 [`docs/project-overview.md` §7](docs/project-overview.md#7-运行护栏与配置)。

另外可通过 `config.orchestration` / `config.context.semantic` 配置多智能体调度与语义上下文的细节;`config.recovery.enabled = true` 开启持久化恢复。详细键名见 `node ./bin/inkstone.js config show` 或 [`docs/project-overview.md`](docs/project-overview.md)。

---

## 🏗️ 架构一览

```text
CLI / TUI / GUI
   └─ src/index.js · createKernel()
        ├─ core/runtime          Agent 生命周期 · 执行循环 · 验证-修复
        ├─ core/orchestration    多智能体:路由 · 拆派 · 并行隔离 · 两级审核 · 重规划
        ├─ core/recovery         持久化恢复(含编排级 durable)· 项目锁
        ├─ context               分层上下文引擎 · 语义符号检索(semantic,opt-in)
        ├─ deepseek              模型网关 · 路由 · JSON mode · SSE streaming · FIM · 用量
        ├─ tools                 注册表 · schema · executor · 权限引擎 · 15 个内置工具
        ├─ edits                 diff 预览 / 应用 / 回滚(事务化)
        ├─ sessions              事件时间线(56 种事件 · JSONL + 哈希链)· 分支 · rewind
        ├─ workspace · security · shared
        └─ apps/                 共享事件展示契约 · CLI/TUI 适配 · GUI 内核宿主
```

核心原则:**一个**内核门面、**一条** 工具执行路径、**一套** 编辑/回滚服务、**一条** 会话时间线。UI 只负责输入、展示与审批。

> 架构细节、工具执行顺序、编辑回滚、持久化恢复、安全不变量、会话事件全集与目录地图,详见 **[`docs/project-overview.md`](docs/project-overview.md)**。

---

## 🔐 安全

- 文件路径以 realpath 校验 workspace 边界,阻断 symlink 逃逸
- `shell` 只接受结构化 argv,以 `shell:false` 执行(无 shell 注入面)
- `web_fetch` 封锁 localhost / 私网 / link-local / IPv4-mapped IPv6 / IPv6 literal,每跳 redirect 重新校验
- 输出中的密钥脱敏(Bearer / api_key);GUI `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` + IPC 白名单;API Key 明文只落 `.deepseek-code/`、渲染路径只出现掩码
- 工具 category 只信任注册表定义;destructive 操作永不被 trust rule 自动放行

---

## 🧪 开发

```bash
npm test            # node --test:全部用例(当前 932 全绿)
npm run check       # node --check:全部源码语法校验
```

文档维护顺序(代码 → specs/plans → project-overview → CHANGELOG → 索引;主 README 中+英**仅大版本更新时重写,时机由开发者抉择**)与规范见 [`docs/README.md`](docs/README.md)。

**版本命名**自 v1.0.0 起采用语义化版本 `major.minor.patch`:大版本(major,例如 v2.0.0)对应大功能更新 / 新模型代际适配,**由维护者抉择启动**;小版本(minor)对应大版本规划内的功能累加,不重构核心;补丁(patch)对应文档 / 小修 / 测试。详见 [`docs/README.md` §版本命名规则](docs/README.md#版本命名规则)。

---

## 📚 文档

- **[`docs/project-overview.md`](docs/project-overview.md)** —— 项目深入说明(架构 / 工具 / 编辑 / 恢复 / 安全 / 事件 / 目录)
- [`docs/README.md`](docs/README.md) —— 文档中心:索引 + 维护规范 + 版本命名规则
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) —— 版本日志(当前 v1.0.0,整合此前全部迭代)
- `docs/specs/` · `docs/plans/` —— 设计文档与实施计划(按 architecture / backend / frontend 划分)

---

## 📄 许可证

[Apache-2.0](LICENSE)。
