# DeepSeek Code 文档中心

本目录收录 DeepSeek Code 的全部项目文档。所有文档按**类型**分目录,设计与计划再按**前端 / 后端 / 架构**细分,便于查阅与维护。

> 根目录的 [`README.md`](../README.md) 是项目入口;本文件是文档索引与维护规范。

---

## 目录结构

```
docs/
  README.md                 ← 本文件:文档索引 + 维护规范
  project-overview.md       ← 项目深入说明(架构/工具/编辑/恢复/安全/事件/目录)
  CHANGELOG.md              ← 项目变更日志(版本里程碑)
  specs/                    ← 设计文档(design specs:目标、架构、取舍)
    architecture/           ← 跨端架构总览(V1/V2 运行时设计)
    backend/                ← 内核 / runtime / 工具 / 编辑 / 会话 / 恢复 设计
    frontend/               ← GUI / CLI / TUI 界面设计
  plans/                    ← 实施计划(implementation plans:分步落地)
    roadmap/                ← 宏观阶段(phase-0..5)与未来路线图
    backend/                ← 后端按特性的实施计划
    frontend/               ← 前端按特性的实施计划
```

**specs 与 plans 的区别**:`specs/` 回答"要做成什么样、为什么这么设计";`plans/` 回答"分几步、每步怎么做、怎么验证"。一个特性通常先有 spec 再有 plan。

---

## 文档维护规范与更新顺序

> ⚠️ 任何代码变更落地后,**按下表顺序**(代码 → 设计层 → 叙述层 → 索引)更新文档。每步都**条件触发**——与本次变更无关的就跳过,但先后不要打乱。照此路径走,接手者就能清楚"改了什么、为什么改、怎么用"。

| 阶段 | 顺序 | 文档 | 何时更新 |
|------|----|------|---------|
| **0 · 落地** | 1 | **代码** | 变更先落地,并通过 `npm test` / `npm run check` / `git diff --check` |
| **1 · 设计层**<br>(做成什么样 / 分几步) | 2 | `docs/specs/<area>/` | 设计变化时,更新对应设计文档,使其反映**实际形态**(非最初设想) |
| | 3 | `docs/plans/<area>/` | 勾掉已完成任务、登记新发现的子任务 |
| | 4 | [`project-overview.md`](project-overview.md) | 变更**触及架构 / 内核 / 工具 / 编辑回滚 / 恢复 / 安全 / 会话事件 / 配置 / 目录**时,同步这份内部总览(它是"活的"参考,非 per-feature spec) |
| **2 · 叙述层**<br>(面向读者) | 5 | [`CHANGELOG.md`](CHANGELOG.md) | 追加一条变更(版本号 + 日期 + 条目);用户可见或重要的内部变更都要记 |
| | 6 | 根 [`README.md`](../README.md) **+ 英文镜像 [`README.en.md`](../README.en.md)** | 仅当影响**命令 / 架构说明 / 使用方式**时;**中英两份门面必须同步**(改了中文就改英文) |
| **3 · 索引** | 7 | `docs/README.md`(本文件) | 仅当**新增 / 移动 / 删除**文档,需要同步结构图与索引时 |

**一句话顺序**:代码 → specs/plans → project-overview → CHANGELOG → README(中+英)→ 索引。

**`<area>` 取值**:`backend`(内核/runtime)、`frontend`(GUI/CLI/TUI)、`architecture`(跨端架构)。

**新文档命名约定**:`YYYY-MM-DD-<topic>.md`(plan)、`YYYY-MM-DD-<topic>-design.md`(spec),与现有文件保持一致。

**给自动化工具的约定**:`brainstorming` / `writing-plans` 等技能产出的 spec/plan,落到 `docs/specs/<area>/` 与 `docs/plans/<area>/`,**不要**再创建 `docs/superpowers/` 这一层。

---

## 索引

### 项目说明(内部深入)
- [project-overview](project-overview.md) — **维护者视角的项目说明**:架构内核 · DeepSeek 适配 · 工具平面 · 编辑/回滚 · 持久化恢复 · 运行护栏 · 安全不变量 · 会话事件全集 · 存储布局 · 目录地图

### specs/architecture — 跨端架构
- [deepseek-code-v1-design](specs/architecture/2026-05-29-deepseek-code-v1-design.md) — V1 整体设计
- [deepseek-code-v2-clean-runtime-design](specs/architecture/2026-05-30-deepseek-code-v2-clean-runtime-design.md) — V2 干净运行时架构
- [v3-roadmap-design](specs/architecture/2026-06-24-v3-roadmap-design.md) — **V3 路线图**:四阶段 + 三支柱 + 目标 Agent 架构 + 三层多 agent + 前端三端

### specs/backend — 后端设计
- [v2-7 approval-resume](specs/backend/2026-05-30-v2-7-approval-resume-design.md)
- [v2-8 verifier-repair-loop](specs/backend/2026-05-31-v2-8-verifier-repair-loop-design.md)
- [v2-9 context-engine](specs/backend/2026-05-31-v2-9-context-engine-design.md)
- [v2-10 context-cache-usage-telemetry](specs/backend/2026-05-31-v2-10-context-cache-usage-telemetry-design.md)
- [v2-11 transactional-edit-dirty-workspace](specs/backend/2026-05-31-v2-11-transactional-edit-dirty-workspace-design.md)
- [v2-12 branching-conversation-rewind](specs/backend/2026-05-31-v2-12-branching-conversation-rewind-design.md)
- [v2-13 rewind-hardening-recovery](specs/backend/2026-05-31-v2-13-rewind-hardening-recovery-design.md)
- [v2-17 chat-kernel-unification](specs/backend/2026-05-31-v2-17-chat-kernel-unification-bypass-closure-design.md)
- [v2-18 durable-recovery-resume-hardening](specs/backend/2026-06-01-v2-18-durable-recovery-resume-hardening-design.md)
- [agent-layered-memory-design](specs/backend/2026-06-24-agent-layered-memory-design.md) — **Agent 分层记忆系统**:双记忆 + 七层 + 三级分化 + 巩固器
- [v3-phase-b semantic-context](specs/backend/2026-06-26-v3-phase-b-semantic-context-design.md) — **Phase B 语义级上下文引擎**:WASM tree-sitter 单解析栈 + 可靠静态子集 + unresolved 一等事实 + confidence/provider 扩展口(opt-in)
- [v3-phase-b+1 method-hints](specs/backend/2026-06-26-v3-phase-b-plus1-method-hints-design.md) — **B+1 方法消歧**:member-call 唯一匹配 → probable + CLI `--semantic-context` / `--include-method-hints`(默认关)
- [v3-phase-b+3 multi-language](specs/backend/2026-06-26-v3-phase-b-plus3-multi-language-design.md) — **B+3 扩语言**:tree-sitter query 统一抽取(JS/TS shadow-parity 迁移)+ Python(尽力静态模块解析 + 可配 import roots)
- [v3-phase-c1+c2 orchestration](specs/backend/2026-06-27-v3-phase-c1-c2-orchestration-design.md) — **C1+C2 多智能体编排**:统一入口 + 确定性路由器(单/多 agent 合并)+ Orchestrator/Planner/串行 Worker + **两级审核**(子自审 + 独立 Reviewer)+ 成本闸常开;复用 `agent-runtime` 实例,引擎不改
- [v3-phase-c3 parallel-isolation](specs/backend/2026-06-27-v3-phase-c3-parallel-isolation-design.md) — **C3 并行写隔离**:无依赖+不重叠子任务并行,每 Worker fs 拷贝隔离工作区 + 绑定该目录工具平面 → 每 subtask 原子事务回放合并(快照一致性 CAS + 实际范围校验 + 严格路径归一化 + 零残留 retry/启动清扫);`maxParallelWorkers=1` 退化串行零回归
- [v3-phase-c5 replan-resume](specs/backend/2026-06-27-v3-phase-c5-replan-resume-design.md) — **C5 重规划 + 持续派发**:确定性回合循环(`planner.replan→{done,subtasks}`,模型只产结构化、程序闸控终止)+ 严格 replan schema + 无进展守卫 + **同进程编排级续跑**(暂停存编排状态、`approve` 路由 orchestrator、不重 plan/不重复派发);`maxRounds=1` 退化 C1+C2 零回归

### specs/frontend — 前端设计
- [v2-14 gui-workbench-branch-rewind](specs/frontend/2026-05-31-v2-14-gui-workbench-branch-rewind-design.md)
- [v2-15 natural-agent-workbench](specs/frontend/2026-05-31-v2-15-natural-agent-workbench-design.md)
- [v2-16 gui-interaction-hardening](specs/frontend/2026-05-31-v2-16-gui-interaction-hardening-design.md)
- [v2-frontend-workbench-redesign](specs/frontend/2026-05-31-v2-frontend-workbench-redesign-design.md)

### plans/roadmap — 宏观阶段
- [phase-0 kernel-foundation](plans/roadmap/2026-05-29-phase-0-kernel-foundation.md)
- [phase-1 core-intelligence](plans/roadmap/2026-05-29-phase-1-core-intelligence.md)
- [phase-2 security-extension](plans/roadmap/2026-05-30-phase-2-security-extension.md)
- [phase-3 experience](plans/roadmap/2026-05-30-phase-3-experience.md)
- [phase-4 gui](plans/roadmap/2026-05-30-phase-4-gui.md)
- [phase-5 polish](plans/roadmap/2026-05-30-phase-5-polish.md)

### plans/backend — 后端实施计划
- [v3-phase-b semantic-context](plans/backend/2026-06-26-v3-phase-b-semantic-context.md) — **Phase B 实施计划**:15 任务 TDD(ParserProvider → extractor → indexer → dependency-graph → symbol-selector → 门面接线 → 文档)
- [v3-phase-b+1 method-hints](plans/backend/2026-06-26-v3-phase-b-plus1-method-hints.md) — **B+1 实施计划**:6 任务 TDD(member_property → 唯一匹配 probable + Map neighbors → engine 透传 → kernel-options 合并 → CLI 标志 → 文档)
- [v3-phase-b+3 multi-language](plans/backend/2026-06-26-v3-phase-b-plus3-multi-language.md) — **B+3 实施计划**:12 任务 / M1–M6(query-runner + JS/TS shadow-parity 迁移 → Python 尽力静态解析 → 退役旧 extractor)
- [v3-phase-c1+c2 orchestration](plans/backend/2026-06-27-v3-phase-c1-c2-orchestration.md) — **C1+C2 实施计划**:12 任务 / M1–M6(schema + 确定性路由器 → 工具子集 + worker/reviewer 工厂 → planner → 派发循环 + synth → orchestrator + kernel 接线 → 回归 + 文档)
- [v3-phase-c3 parallel-isolation](plans/backend/2026-06-27-v3-phase-c3-parallel-isolation.md) — **C3 实施计划**:8 任务 / M1–M8(path-overlap → workspace-snapshot → iso-workspace → buildToolPlane 重构 → merge-back(净 diff+CAS) → batch-planner → 批次并行派发 → config+sweep+文档)
- v2-0 skeleton-protocol-foundation · v2-1 deepseek-gateway · v2-2 tool-plane · v2-3 edit-service · v2-4 runtime-loop · v2-6 release-closure · v2-7 approval-resume · v2-8 verifier-repair-loop · v2-9 context-engine · v2-10 context-cache-usage-telemetry · v2-11 transactional-edit-dirty-workspace · v2-12 branching-conversation-rewind · v2-13 rewind-hardening-recovery · v2-17 chat-kernel-unification · v2-18 durable-recovery-resume-hardening · **v2-20a runtime-cost-timeout-guardrails** · **v2-20b guardrail-injection-graceful-stop** · **v2-20c malformed-toolcall-retry** · **v2-20d resume-path-guardrail-alignment** · **v2-20e repair-path-model-timeout** · **v2-20f guardrail-defaults-config** · **v2-19 delete-v1-legacy** · **v2-18c edit-rewind-journaling**
- 文件位于 [`plans/backend/`](plans/backend/)

### plans/frontend — 前端实施计划
- [v2-5 interface-migration](plans/frontend/2026-05-30-v2-5-interface-migration.md)
- [v2-14 gui-workbench-branch-rewind](plans/frontend/2026-05-31-v2-14-gui-workbench-branch-rewind.md)
- [v2-15 natural-agent-workbench](plans/frontend/2026-05-31-v2-15-natural-agent-workbench.md)
- [v2-16 gui-interaction-hardening](plans/frontend/2026-05-31-v2-16-gui-interaction-hardening.md)
- [v2-frontend-workbench-redesign](plans/frontend/2026-05-31-v2-frontend-workbench-redesign.md)
- [future-gui-deepseek-code-ide-redesign](plans/frontend/2026-06-01-future-gui-deepseek-code-ide-redesign.md)
- [gui-frontend-optimization-plan](plans/frontend/gui-frontend-optimization-plan.md)

---

## 版本与里程碑

完整的版本演进见 [`CHANGELOG.md`](CHANGELOG.md)。当前主线 **V2** 已实现内核统一、工具平面、编辑/回滚、验证修复、上下文引擎、分支/rewind、持久化恢复(V2-18);**V3** 路线图(语义级上下文、多智能体调度、前端三端重构)规划中。
