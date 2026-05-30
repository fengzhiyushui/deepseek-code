# deepseek-code

DeepSeek 专属本地编程助手 — v1.0

基于 DeepSeek V4 模型，提供 Agent Loop、双通道推理（Think/Act）、1M 上下文窗口、可编程权限系统、MCP 工具生态，以及 CLI / TUI / GUI 三种交互界面。

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
src/kernel/ (10 modules, 124 tests)
├── event-bus.js            — 事件总线（publish/subscribe/once）
├── session-log.js          — 追加日志（JSONL + hash chain）
├── session-manager.js      — 事件持久化桥接
├── config-provider.js      — 配置引擎（三层合并 + ModelProfile）
├── kernel-api.js           — 内核统一入口
├── model-provider.js       — DeepSeek 双通道适配（Think/Act/FIM）
├── context-engine.js       — 三层上下文引擎（冷/温/热 + cache-aware）
├── task-orchestrator.js    — 显式状态机（11 状态 + 4 级自治）
├── permission-engine.js    — 权限引擎（8×4 矩阵 + 可编程规则）
└── tool-registry.js        — 工具注册表（16 内置工具 + workspace 保护）

gui/ (Electron 桌面应用)
├── main.js                 — 主进程（kernel + 8 IPC handlers）
├── preload.js              — 安全上下文桥接
└── renderer/               — 渐进三层界面（Surface/Context/Control）
```

## 命令

```text
deepseek-code tui              # 交互式终端界面（状态栏 + 时间线）
deepseek-code ask "问题"        # 基于项目上下文提问
deepseek-code chat [--reset]   # 连续对话（REPL 模式）
deepseek-code edit "需求" --file <path> [--dry-run] [--yes]  # 生成补丁
deepseek-code scan             # 扫描项目文件
deepseek-code search "关键词"    # 搜索代码
deepseek-code test [command]   # 运行测试（自动检测框架）
deepseek-code diff             # 查看 Git 差异
deepseek-code config init      # 配置 API 密钥
deepseek-code config show      # 查看配置
deepseek-code config test      # 测试连接
deepseek-code changes list     # 修改记录
deepseek-code rollback latest  # 回退修改
deepseek-code resume           # 查看会话记录
```

## TUI 界面

方向键选择，回车执行，`q` 退出。功能包括：提问、连续对话、补丁修改、代码搜索、项目扫描、运行测试、Git diff、修改记录、回退、API 配置与测试。

TUI 底部显示状态栏（autonomy / channel / token 用量 / cache hit rate）和最近事件时间线。

## GUI 桌面应用

```bash
cd gui && npm install && npm start
```

渐进三层界面：
- **Surface**：聊天视图（零门槛）
- **Context**：Agent 活动实时日志
- **Control**：计划审查 / 权限确认全屏面板

## 自治级别

| 级别 | 行为 | 适用场景 |
|------|------|----------|
| **supervised** | 每步确认 | install/network |
| **gated** (默认) | 计划确认 + 执行自动 | write/edit |
| **auto** | 全自动执行 | read/query |
| **full-auto** | 无确认 | 用户显式 --auto |

## 权限类别

8 类资源 × 4 级自治 = 32 项默认矩阵。支持用户策略（`~/.deepseek-code/permissions.json`）、项目规则（`.deepseek-code/permissions.json`）和可编程规则。

## 工具系统

16 个内置工具：`read`, `write`, `edit`, `delete`, `grep`, `glob`, `ls`, `shell`, `test`, `git_read`, `git_write`, `web_search`, `web_fetch`, `ask_user`, `memory`, `task`

支持 MCP 协议（Model Context Protocol）和 JS 插件扩展。

## 设计边界

- 文件路径必须在项目根目录内（realpath 验证）
- Shell 命令仅接受结构化 `argv`，不解析原始 shell 字符串
- destructive 操作永不可自动允许
- 模型 thinking/reasoning 内容不暴露给用户，不持久化
- 配置分层：环境变量 > 项目本地 > 全局
- 运行测试自动检测框架：npm test → pytest → cargo test → go test → node --test
