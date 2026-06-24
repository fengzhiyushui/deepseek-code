# Changelog

本文件记录 DeepSeek Code 的版本演进与重要里程碑。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/);版本以 **V2-N 里程碑**为单位组织(项目尚未发布语义化版本号)。

> 维护约定见 [`docs/README.md` 文档维护规范](README.md#文档维护规范更新顺序):代码 → specs → plans → **本文件** → README → 索引。

---

## [Unreleased]

### 规划中 — V3 路线图
- **支柱①语义级上下文**:从启发式文件分层升级为 AST/符号级检索 + 依赖图。
- **支柱②多智能体调度**:三层 agent(主/次/子)+ 两级审核 + 双记忆 + 可开关的跨任务经验沉淀。
- **支柱③前端三端重构**:GUI 迁 React + Vite + Semi UI(Agent-aware 编辑器 + DeepSeek FIM),CLI / TUI 打磨;先冻结三端共享契约。
- **V2 收尾(先行)**:合并 V2-18 持久化恢复;V2-19 删除 V1 legacy 并收敛 `apps/`;V2-20 稳定化(补成本预算闸 + 超时处理)。
- 设计文档:[`specs/architecture/2026-06-24-v3-roadmap-design.md`](docs/specs/architecture/2026-06-24-v3-roadmap-design.md)、[`specs/backend/2026-06-24-agent-layered-memory-design.md`](docs/specs/backend/2026-06-24-agent-layered-memory-design.md)。

### 进行中
- **V2-18 持久化恢复 / Resume 加固**(worktree `v2-18-durable-recovery`):事务日志 + 二进制 preimage 捕获、项目锁 + epoch fencing、恢复收件箱、启动恢复扫描;已接入 `createKernel()` 并暴露 `kernel.recovery.*`,新增 `kernel.dispose()` 释放项目锁。

---

## V2 — 干净运行时(主线)

### V2-17 · Chat Kernel 统一
- `chat` 命令统一走 V2 kernel,默认 `read-only`,会话内 `/mode` 可切 `gated` / `auto`,关闭旁路通道。

### V2-14 ~ V2-16 · GUI 工作台
- GUI workbench 分支/rewind 可视化、自然 agent 工作台、交互加固;渲染器偏好持久化、inspector 关闭流、Electron smoke 测试。

### V2-11 ~ V2-13 · 事务编辑与分支 rewind
- 事务化编辑 / 脏工作区处理;会话分支(从任意 turn fork);rewind 时间旅行与回滚加固。

### V2-8 ~ V2-10 · 智能与上下文
- 验证-修复闭环(verifier + repair loop);上下文引擎(文件分层 P0–P4 + token 预算 + 快照);上下文缓存与用量遥测。

### V2-7 · 审批与恢复
- 审批暂停 turn 与进程内 resume。

### V2-5 ~ V2-6 · 界面迁移与发布收口
- CLI / TUI / GUI 迁移到 V2 kernel;发布收口。

### V2-0 ~ V2-4 · 内核地基
- 协议骨架与事件时间线;DeepSeek 模型网关(路由 / JSON mode / streaming / FIM / 用量);工具平面(注册表 / schema / executor / 权限);编辑服务(preview / apply / rollback);agent runtime 执行循环。

---

## V1 — 原始实现(legacy)

> 仍保留服务于未迁移命令(`scan` / `search` / `diff` / `config` / `changes` / `rollback` / `resume` / `tui`),完整删除计划见 V2-19。

- 终端 AI 编程 agent:`ask` / `edit` / `chat`、项目上下文扫描、unified diff 应用与回滚、DeepSeek 直连、Git 差异、项目搜索。
- `src/kernel/*` V1 内核抽象层:EventBus、SessionLog(append-only + 哈希链)、ConfigProvider、ModelProvider、ContextEngine、TaskOrchestrator、PermissionEngine、ToolRegistry、SessionManager。
- Electron GUI 脚手架(安全 IPC、Surface/Context/Control 三层、XSS-safe 渲染)。
- 安全基线:workspace 边界 realpath 校验、SSRF 防护、shell 结构化 argv、secret 脱敏。
