# DeepSeek Code

DeepSeek Code 是一个面向 DeepSeek 的本地编程 Agent。它提供 CLI、TUI 和 Electron GUI 三种入口，并通过同一个 V2 Kernel 完成模型调用、工具执行、编辑应用、测试验证、权限控制和会话事件记录。

## 当前状态

V2 已经成为主要运行路径：

- `deepseek-code ask` 使用 V2 runtime。
- `deepseek-code edit` 使用 V2 runtime、V2 tool plane 和 V2 edit service。
- `deepseek-code test` 使用 V2 test tool，并传播真实退出码。
- TUI 和 GUI 订阅 V2 session events。
- `deepseek-code chat` 使用 V2 kernel，默认 `read-only`，可在会话中用 `/mode` 切换到 `gated` 或 `auto`。
- Legacy 命令仍保留：`scan`、`search`、`diff`、`config`、`changes`、`rollback`、`resume`。

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

- 审批、repair、rewind 的进程内恢复已具备;**跨进程崩溃安全恢复**(事务日志 + 项目锁 + 启动恢复)由 V2-18 提供,正在收尾合并(见 CHANGELOG 的 Unreleased)。
- repair executor 目前是单轮修复执行器，多轮自动诊断和更复杂的验证策略仍待扩展。
- 会话、变更记录和分支/rewind 目前没有跨进程文件锁；不要同时在同一项目目录运行多个会写入状态的实例。
- legacy `src/kernel/*`、`src/agent.js`、`src/provider.js` 仍保留，用于兼容未迁移命令和旧接口；完整删除和 `apps/` 目录收敛留给 V2-19。
- GUI usage stats 在离线或未接入真实模型调用时可能显示零值。
- `chat` 已走 V2 kernel，默认 `read-only`，可在会话中用 `/mode` 切换到 `gated` 或 `auto`。

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
docs/          项目文档(specs / plans / CHANGELOG),见下方「文档维护」
```

## 文档维护

全部项目文档收录在 [`docs/`](docs/),按类型分目录,设计与计划再按前端 / 后端 / 架构细分:

```text
docs/
  README.md          文档索引 + 维护规范
  CHANGELOG.md        版本里程碑
  specs/              设计文档:architecture / backend / frontend
  plans/              实施计划:roadmap / backend / frontend
```

**更新顺序**(任何变更落地后,按此路径同步文档,方便接手维护):

1. **代码** 变更并通过 `npm test` / `npm run check`
2. `docs/specs/<area>/` 对应设计文档(反映实际形态)
3. `docs/plans/<area>/` 对应计划(勾掉已完成任务)
4. [`docs/CHANGELOG.md`](docs/CHANGELOG.md) 追加版本/日期/变更条目
5. `README.md`(本文件)——仅当影响命令 / 架构 / 使用方式
6. [`docs/README.md`](docs/README.md) 索引——仅当新增 / 移动 / 删除文档

完整规范见 [`docs/README.md`](docs/README.md#文档维护规范更新顺序)。
