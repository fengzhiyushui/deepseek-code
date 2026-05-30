# deepseek-code

DeepSeek 专属本地编程助手 — v1.0

基于 DeepSeek V4 模型（deepseek-v4-pro / deepseek-v4-flash），提供 Agent Loop、双通道推理（Think/Act）、1M 上下文窗口、8×4 可编程权限系统、16 内置工具，以及 CLI / TUI / GUI 三种交互界面。

## 快速开始

```bash
node bin/deepseek-code.js config init --api-key sk-xxx
node bin/deepseek-code.js tui
node bin/deepseek-code.js ask "解释这个项目的结构"
node bin/deepseek-code.js chat
node bin/deepseek-code.js edit "修复边界条件" --file src/example.js
```

环境变量：

```bash
set DEEPSEEK_API_KEY=sk-xxx
set DEEPSEEK_MODEL=deepseek-v4-pro
set DEEPSEEK_BASE_URL=https://api.deepseek.com
set DEEPSEEK_REASONING_EFFORT=max
```

## 架构

```
src/kernel/ (10 modules, 129 tests)
├── event-bus.js            — 事件总线（publish/subscribe/once + 错误隔离）
├── session-log.js          — 追加日志（JSONL + schema v1 + hash chain）
├── session-manager.js      — 事件持久化桥接（EventBus → SessionLog）
├── config-provider.js      — 配置引擎（三层合并 + reasoning/fast/fim ModelProfile）
├── kernel-api.js           — 内核统一入口（CLI/TUI/GUI 共享）
├── model-provider.js       — DeepSeek 双通道适配（Think/Act + FIM + invoke/streamDelta）
├── context-engine.js       — 三层上下文引擎（冷/温/热 + P0-P4 优先级 + cache-aware）
├── task-orchestrator.js    — 显式状态机（11 状态 + 4 级自治 + fast paths）
├── permission-engine.js    — 权限引擎（8×4 矩阵 + 信任层级 + TTL 指纹 + argv 匹配）
└── tool-registry.js        — 工具注册表（16 内置 + workspace realpath + resolveCategory）

gui/ (Electron 桌面应用)
├── main.js                 — 主进程（kernel + 8 IPC handlers）
├── preload.js              — 安全上下文桥接（contextIsolation）
└── renderer/               — 渐进三层界面（Surface/Context/Control）
```

## 实施状态

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 0 | Kernel 底座（EventBus, SessionLog, ConfigProvider, KernelAPI） | ✅ |
| Phase 1 | 核心智能（ModelProvider, ContextEngine, TaskOrchestrator） | ✅ |
| Phase 2 | 安全与扩展（Permission Engine, Tool Registry） | ✅ |
| Phase 3 | 体验层（Session Manager, TUI 增强） | ✅ |
| Phase 4 | GUI（Electron 渐进三层界面） | ✅ |
| Phase 5 | 打磨（web_fetch SSRF, memory 工具, 多测试框架检测, 文档） | ✅ |

## 双通道推理

| 通道 | 模型 | thinking | 上下文 | 用途 |
|------|------|----------|--------|------|
| **Think** | deepseek-v4-pro | enabled + reasoning_effort | 最大 500K tokens | 架构分析、代码审查、计划生成 |
| **Act** | deepseek-v4-flash | disabled | 最大 64K tokens | 代码生成、补丁应用、工具调用 |

支持三档模式切换：省成本 / 均衡（默认） / 最强。FIM（Fill-in-the-Middle）通过 `/completions` 接口支持小范围精修。

## 命令

```text
deepseek-code tui              # 交互式终端界面（状态栏 + 时间线）
deepseek-code ask "问题"        # 基于项目上下文提问（Think 通道）
deepseek-code chat [--reset]   # 连续对话（REPL 模式，保留上下文）
deepseek-code edit "需求" --file <path> [--dry-run] [--yes]  # 生成补丁并确认
deepseek-code scan             # 扫描项目文件索引
deepseek-code search "关键词"    # 搜索代码（ripgrep 优先）
deepseek-code test [command]   # 运行测试（自动检测：npm/pytest/cargo/go）
deepseek-code diff             # 查看 Git 差异
deepseek-code config init [--api-key <key>] [--model <m>] [--thinking] [--reasoning-effort <e>]
deepseek-code config show      # 查看当前配置（密钥脱敏）
deepseek-code config test      # 测试 DeepSeek API 连接
deepseek-code changes list     # 查看修改记录
deepseek-code changes show latest  # 查看修改详情
deepseek-code rollback latest  # 回退最近修改（快照恢复）
deepseek-code resume           # 查看最近 10 条会话记录
```

## TUI 界面

```bash
node bin/deepseek-code.js tui
```

方向键选择，回车执行，`q` 退出。功能包括：提问、连续对话、补丁修改、代码搜索、项目扫描、运行测试、Git diff、修改记录、回退、API 配置与测试。

TUI 底部显示实时状态栏（autonomy / channel / token 用量 / cache hit rate）和最近事件时间线。启动时自动创建 Kernel 实例，状态栏与 Agent 状态同步。

## GUI 桌面应用

```bash
cd gui && npm install && npm start
```

渐进三层界面：
- **Surface**：聊天视图（输入框 + 对话区），零门槛
- **Context**：Agent 活动实时日志（工具调用、状态转移）
- **Control**：计划审查 / 权限确认全屏面板

安全隔离：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、CSP 限制、IPC 白名单、XSS 防护（零 innerHTML）。

## 自治级别

| 级别 | Plan 确认 | Execute 确认 | Review 确认 | 适用场景 |
|------|-----------|-------------|-------------|----------|
| **supervised** | 必须 | 每步 | 必须 | install/network/destructive |
| **gated** (默认) | 必须 | 自动 | 必须 | write/edit 类型任务 |
| **auto** | 自动 | 自动 | 必须 | read/query 类型任务 |
| **full-auto** | 自动 | 自动 | 自动 | 用户显式 --auto 或 "just do it" |

## 权限系统

8 类资源 × 4 级自治 = 32 项默认矩阵。`destructive` 硬编码不可自动允许。`read_secret` 即使 approve 也走脱敏链路。

三层信任链：全局用户策略（`~/.deepseek-code/permissions.json`）> 已信任项目 JS 规则 > 项目声明式规则 > 默认矩阵。

Shell 命令仅接受结构化 `{ argv: ["npm", "test"], cwd, shell: false }`，拒绝原始 cmd 字符串。TTL 授权绑定 SHA256(tool + argv + cwd + resource + projectId) 指纹。

## 工具系统

16 个内置工具，全部通过 Permission Engine 审批：

| 工具 | 类别 | 说明 |
|------|------|------|
| `read` | read | 读取文件（workspace realpath 约束） |
| `write` | write_update | 创建/覆写文件 |
| `edit` | write_update | 应用 unified diff 补丁 |
| `delete` | write_delete | 删除文件或目录 |
| `grep` | read | 正则搜索文件内容 |
| `glob` | read | 文件模式匹配 |
| `ls` | read | 列出目录内容 |
| `shell` | execute | 执行命令（仅 argv，拒绝 cmd 字符串） |
| `test` | execute | 运行测试（自动检测框架） |
| `git_read` | read | Git 只读操作（status/diff/log/show/blame） |
| `git_write` | write_update | Git 写操作（commit/branch/tag） |
| `web_search` | network | 网络搜索 |
| `web_fetch` | network | 获取 URL 内容（含 SSRF 防护） |
| `ask_user` | read | 向用户提问 |
| `memory` | read/write_update/write_delete | 跨会话持久记忆（resolveCategory 动态映射） |
| `task` | execute | 子任务委托（约束工具集） |

`web_fetch` SSRF 防护：阻止 localhost、127.0.0.0/8、169.254.0.0/16、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、IPv6 loopback、IPv4-mapped IPv6。重定向每跳独立校验。DNS rebinding 解析后 IP 验证。

`memory` 工具按 action 动态映射权限类别（read/list→read, write→write_update, delete→write_delete），存储于 `~/.deepseek-code/projects/<hash>/memory/`，支持 `ctx.memoryRoot` 注入。

## 设计边界

- 文件路径必须在项目根目录内（realpath 符号链接解析 + workspace 越界检查）
- Shell 仅接受结构化 `argv`，不解析原始 shell 字符串
- `destructive` 操作硬编码不可自动允许（trust rules 无法覆盖）
- 模型 reasoning_content 不暴露给用户，不持久化到 timeline
- 配置三层合并：环境变量 > 项目本地 `.deepseek-code/config.json` > 全局 `~/.deepseek-code/config.json`
- 运行测试自动检测框架：npm test → pytest → cargo test → go test ./... → node --test
- 事件持久化：append-only JSONL + schema v1 + SHA-256 hash chain + 损坏行恢复
- Agent 不可重入：`submit()` 在非 Idle/Terminal 状态时抛 BUSY 错误
- 工具定义字段（category/risk_level/side_effect）以注册定义为准，调用方不可伪造
