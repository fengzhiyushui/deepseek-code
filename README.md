# DeepSeek Code

DeepSeek Code 是一个面向 DeepSeek 的本地编程 Agent。它提供 CLI、TUI 和 Electron GUI 三种入口，并通过同一个 V2 Kernel 完成模型调用、工具执行、编辑应用、测试验证、权限控制和会话事件记录。

## 当前状态

V2 已经成为主要运行路径：

- `deepseek-code ask` 使用 V2 runtime。
- `deepseek-code edit` 使用 V2 runtime、V2 tool plane 和 V2 edit service。
- `deepseek-code test` 使用 V2 test tool，并传播真实退出码。
- TUI 和 GUI 订阅 V2 session events。
- Legacy 命令仍保留：`chat`、`scan`、`search`、`diff`、`config`、`changes`、`rollback`、`resume`。

运行验证：

```powershell
npm.cmd test
npm.cmd run check
git diff --check
```

## 快速开始

```powershell
npm install
node ./bin/deepseek-code.js help
```

配置 DeepSeek API Key：

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
```

或写入项目配置：

```powershell
node ./bin/deepseek-code.js config init --api-key sk-...
```

常用命令：

```powershell
node ./bin/deepseek-code.js ask "解释这个项目的架构"
node ./bin/deepseek-code.js edit "修复 README 中的拼写问题" --dry-run
node ./bin/deepseek-code.js edit "修复 README 中的拼写问题" --yes
node ./bin/deepseek-code.js test
node ./bin/deepseek-code.js tui
```

GUI：

```powershell
cd gui
npm install
npm start
```

## V2 架构

```text
CLI / TUI / GUI
  -> src/index.js createKernel()
  -> src/core/runtime
  -> src/deepseek
  -> src/tools
  -> src/edits
  -> src/sessions
  -> src/workspace / src/security / src/shared
```

关键原则：

- 一个 Agent runtime。
- 一个 ToolExecutor 执行路径。
- 一个 EditService 编辑和回滚路径。
- 一个 V2 session timeline。
- UI 只负责输入、展示和审批，不拥有 agent 业务逻辑。

## DeepSeek 适配

`src/deepseek/` 负责 DeepSeek 专属协议：

- 模型路由：reply、act、plan、review、repair、fim。
- JSON mode guard：只有明确要求 JSON 的结构化调用才启用 `response_format`。
- SSE streaming parser。
- tool call normalization 和安全 JSON parse。
- usage tracker：token、reasoning token、cache hit/miss、latency。
- FIM client 使用 `deepseek-v4-pro`。

## 工具平面

V2 内置工具包括：

- 文件：`read`、`ls`、`grep`、`glob`
- 编辑：`diff_preview`、`diff_apply`、`diff_rollback`、`edit`
- 进程：`shell`、`test`、`git`
- 网络和记忆：`web_fetch`、`memory`
- 协作：`task`、`ask_user`

工具执行顺序固定：

```text
ToolCall
  -> schema validation
  -> parameter normalization
  -> permission decision
  -> approval if required
  -> execution
  -> result redaction
  -> tool result event
  -> model feedback
```

## 编辑与回滚

V2 复用成熟的 legacy diff pipeline，并通过 `src/edits/` 暴露成服务：

- `preview(diff)`：解析 diff 并生成摘要，不写文件。
- `apply({ diff, prompt, approval_id })`：预检路径、创建快照、应用 diff、记录 change id。
- `rollback(change_id)`：回滚指定变更。
- `describe(change_id)` / `list({ limit })`：查看变更记录。

## 安全不变量

- 文件路径使用 realpath 检查 workspace 边界，防止 symlink 逃逸。
- 工具 category 只信任注册表定义，不信任模型传入字段。
- destructive 操作永不被 trust rule 自动放行。
- shell 只接受结构化 argv，并使用 `shell:false`。
- `web_fetch` 阻断 localhost、私网、link-local、IPv4-mapped IPv6、IPv6 literal，并在每一跳 redirect 后重新校验。
- secret 输出会被 redaction。
- GUI 使用 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true` 和 IPC whitelist。

## 会话时间线

V2 session timeline 记录以下事件：

- `session:start`
- `session:resume`
- `user:message`
- `agent:turn_started`
- `agent:step`
- `model:request`
- `model:response`
- `tool:call`
- `tool:result`
- `permission:decision`
- `approval:requested`
- `approval:resolved`
- `file:diff_preview`
- `file:diff_applied`
- `file:rollback_applied`
- `verification:result`
- `agent:final`
- `agent:error`

默认存储位置是项目内 `.deepseek-code/v2/sessions/`。测试可以通过 `createKernel(root, { sessionRoot })` 注入临时目录。

## 已知限制

- 审批恢复流程尚未贯通：当前可以进入 `awaiting_approval`，批准后继续同一轮 tool loop 仍未实现。
- verifier 当前以 detect-only 为主，不默认运行完整测试套件。
- verification repair 会终止当前 turn，不会自动重新进入修复循环。
- V2 context snapshot 仍是最小实现。
- GUI usage stats 当前可能显示零值，真实 usage tracker 尚未接入 GUI 状态栏。
- legacy 文件仍保留，用于兼容未迁移命令和旧变更记录。

## 目录导览

```text
src/
  core/        Agent lifecycle, protocol, execution loop, verification
  deepseek/    DeepSeek model gateway, router, JSON mode, streaming, FIM
  tools/       Tool registry, schema, executor, permissions, builtin tools
  edits/       Diff preview/apply/rollback service
  sessions/    V2 event types, event log, session manager
  workspace/   Path safety and workspace guards
  security/    Shell policy, SSRF guard, redaction
  apps/        CLI runner/render helpers
  shared/      ID, time, event bus helpers
gui/           Electron shell and renderer
tests/         Unit, integration, and e2e tests
```
