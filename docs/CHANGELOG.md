# Changelog

本文件记录 DeepSeek Code 的版本演进与重要里程碑。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/);版本以 **V2-N 里程碑**为单位组织(项目尚未发布语义化版本号)。

> 维护约定见 [`docs/README.md` 文档维护规范](README.md#文档维护规范与更新顺序):代码 → specs/plans → project-overview → **本文件** → README(中+英)→ 索引。

---

## [Unreleased]

### 规划中 — V3 路线图
- **支柱①语义级上下文**:从启发式文件分层升级为 AST/符号级检索 + 依赖图。
- **支柱②多智能体调度**:三层 agent(主/次/子)+ 两级审核 + 双记忆 + 可开关的跨任务经验沉淀。
- **支柱③前端三端重构**:GUI 迁 React + Vite + Semi UI(Agent-aware 编辑器 + DeepSeek FIM),CLI / TUI 打磨;先冻结三端共享契约。
- **V2 收尾**:✅ 已完成(2026-06-25)——V2-18 持久化恢复(a/b/c)、V2-19 删 V1 legacy、V2-20a–f 运行护栏;详见下方「已落地」。支柱① 语义级上下文 **Phase B 首版已落地**(见下)。
- 设计文档:[`specs/architecture/2026-06-24-v3-roadmap-design.md`](specs/architecture/2026-06-24-v3-roadmap-design.md)、[`specs/backend/2026-06-24-agent-layered-memory-design.md`](specs/backend/2026-06-24-agent-layered-memory-design.md)。

### 已落地 — Phase C-Durable 跨进程编排级 durable 恢复(默认关)
- **跨进程编排续跑**:C5 同进程续跑之上,崩溃/重启后从暂停的编排回合续跑(Option B 完整 worker turn 重水化)。暂停双写(worker turn sidecar + 新 `orchestration-paused/<approvalId>.json`,同 approvalId 关联);重启 `recovery-service` 扫描交叉校验 → `orchestration_paused` inbox;`recovery.resume` 经校验门 → `worker-factory` 确定性重建 worker → 共享 `pausedTurnStore` 重水化 approve → 续跑,不重 plan。**opt-in `recovery.enabled`,默认关**:关闭时 C5 逐字节不变。
- **`agent-runtime.js` 一行未改**:worker 持久化/重水化全靠既有注入依赖(`pausedTurnPersistence` + 可注入共享 `pausedTurnStore`)。
- **5 边界钉死**:① 孤儿(编排 worker sidecar 缺其编排 sidecar / 版本 / 归属不符)一律 `blocked_recovery`,绝不降级单 agent;② 编排 sidecar 只存白名单、不存 raw options / 活对象(活对象由 kernel 重注入);③ 版本/指纹门(workerFactory/toolSubset/subtaskSchema),不符→blocked、不重建;④ approval 归属校验(approvalId/taskId/sessionId/subtask.id/owner 一致);⑤ 预算「配额−已花」续扣、绝不重置。
- M0–M8 / TDD(全程主控内联,模型全 mock)。新模块 `orchestration-recovery-contract.js`(纯契约)+ `orchestration-persistence.js`(原子写+隔离);接线 orchestrator/dispatch-loop/recovery-service/cost-budget/index.js。测试 **782 全绿**(+43;含真跨实例 e2e:kernel A 暂停落盘→dispose→kernel B 重启扫描→resume 重水化 approve→编辑落主区→完成、plan 跨实例仅 1 次;off 零回归)、check OK、`agent-runtime.js` diff 为空。计划:[`plans/backend/2026-06-27-v3-phase-c-durable-orchestration-recovery.md`](plans/backend/2026-06-27-v3-phase-c-durable-orchestration-recovery.md);设计:[`specs/backend/2026-06-27-v3-phase-c-durable-orchestration-recovery-design.md`](specs/backend/2026-06-27-v3-phase-c-durable-orchestration-recovery-design.md)。

### 已落地 — Phase C4 跨任务经验记忆(完整,默认关)
- **跨任务沉淀闭环**:次 agent 在任务边界**提炼教训** → 独立**经验库**(三级分化 + Jaccard 聚簇去重)→ 新任务 planner **检索**相关经验注入拆派 + **风险经验联动权限层**。开关 `config.orchestration.crossTaskLearning = "off"|"on"|"gated"`,**默认 `off`**:关闭时无检索/巩固/升级/事件/目录,与 C1–C5 **逐字节一致**(zero-regression)。
- **两套记忆彻底分开**:经验库存 `<root>/.deepseek-code/v2/experience/`(富 schema + 写队列串行化 + 原子写),与主事实库(`memory` 工具)互不污染;可一键清空而不碰事实与事件时间线。
- **三级分化**(纯函数):`score = conf + 0.1·ln(1+validations) − decay·age − 0.2·misleads` → `T1/T2/T3`(.7/.4/.2);跌破 T3 即删 + 超 `cap`(200)末位淘汰(确定性 tie-break);**聚簇 token-集 Jaccard ≥.6**(修正旧 spec 的「Phase B 符号图」硬伤——那是代码图非文本相似度),`risk`/`procedural` 永不同簇,cue 护栏(停用词/低信息/最少 2 有效 cue)。
- **巩固器 = readonly `agent-runtime` 实例**(引擎不改):模型**只提炼**,程序逻辑控聚簇/打分/定级/淘汰/升降。**后台异步**(`pendingConsolidations`),用户结果不等巩固;`kernel.experience.flush()`/`dispose` 收口不丢写。**「读到≠用到」**:planner 回 `used_experience_ids`,`adopted = used ∩ presented` 才升降(防错误强化)。
- **风险经验 → 权限单调升级**:`riskCues → escalate_only projectRules` 注入**串行主区** worker(并行 iso `auto` worker 不施加);`permission-engine` **只把 default-matrix 的 `allow` 升 `ask`**,绝不降级 / 绝不覆盖用户显式 trust/cache。**`agent-runtime.js` 一行不改**(走已有 `options.projectRules` 转发通道)。
- **`gated` 模式**:risk-kind 高影响写入先入 `pending/` 待审区(`experience:pending_approval`,不影响检索/权限)→ `kernel.experience.{listPending,resolvePending}` 带外审批;TTL(默认 24h)过期自动 deny;`dispose` 未决保留磁盘、绝不自动落库。
- M0–M9 / TDD(全程主控内联,模型全 mock;subagent/codex 复审本环境 429,对抗复审改主控内联补做、钉死 8 处 F1–F8)。测试 **739 全绿**(含真链路 e2e:on 沉淀→检索影响 plan + 风险 allow→ask;off 全链路逐字节同今天)、check OK。计划:[`plans/backend/2026-06-27-v3-phase-c4-experience-memory.md`](plans/backend/2026-06-27-v3-phase-c4-experience-memory.md);设计:[`specs/backend/2026-06-27-v3-phase-c4-experience-memory-design.md`](specs/backend/2026-06-27-v3-phase-c4-experience-memory-design.md)。

### 已落地 — Phase C-Router 分层路由(模型辅助复杂度判定)
- **分层**:确定性路由器从「纯关键词启发式」升级——启发式按特征算 `score` → 三档:`score==0` simple→single、`>=阈值`(默认3)complex→orchestrate **免费短路**,只有 `0<score<阈值` 的**模糊中间档**才花一次便宜模型(`act`/flash 档)判 lane。直接缓解「关键词太窄」(无关键词长编辑请求经**长 edit 捕手** +1 进模糊档由模型判),又避免「全问模型太贵」。
- **模型档默认开**(本项目首次主动打破默认零回归);保留 **opt-out**:`router.model.enabled=false` → 逐字节回到今天(`signals`-only),**裸构造无 `callModel` 亦回退今天**(`modelActive` 双条件)。`signals`(今天 marker+文件)与 `score`(含长 edit 捕手)**严格分离**,长 edit 捕手永不进 `signals` → disabled-parity 守护。
- **三条硬约束**:① 模型档**总调用 ≤ `maxRepairs+1`**(`0⇒≤1`)、**总超时 8000ms 跨重试**,畸形/超时/空网关/抛错**全收敛同一启发式兜底**带短码 `reason`;② 文件 token **归一化去重 + 首个免计**(`min(max(files-1,0),3)`,单文件非复杂度信号,对齐 `minComplexFiles`);③ 可解释输出:`route_resolved` 事件载 `score`/`features`(脱敏:短 token+计数,无完整消息),供实测调阈值。
- `route()` 启发式档**同步**返回(逐字节同今天)、仅模糊档返回 `Promise`(`index.js` 已 await)。事件 `orchestration:route_resolved` 仅模型档发(eventBus 级,不入 `SESSION_EVENT_TYPES`)。`agent-runtime.js` / `classifier.js` **一行未改**。
- 4 任务 / M1–M4 TDD(全程主控内联,模型全 mock);测试 **670 全绿**(M1 8 + M2 14 + M3 5 + M4 e2e 3;含 e2e:模糊→模型→orchestrate、`enabled:false` parity、triage 畸形→兜底不崩)、check OK。计划:[`plans/backend/2026-06-27-v3-phase-c-router-tiered.md`](plans/backend/2026-06-27-v3-phase-c-router-tiered.md);设计:[`specs/backend/2026-06-27-v3-phase-c-router-tiered-design.md`](specs/backend/2026-06-27-v3-phase-c-router-tiered-design.md)。

### 已落地 — Phase C5 重规划 + 持续派发回合循环(同进程编排级续跑)
- **确定性回合循环**:orchestrator 由「规划一次→派发一次」一般化为 `plan → dispatch → replan({completed,failed})→{done,subtasks} → 终止闸 → 下一轮`。**失败重规划**(补/换 corrective 子任务)+ **长任务持续派发**统一为一套机制。回合数/终止/预算由**程序逻辑**判,`replan` 只产结构化下一批(模型不决定"派几轮")。
- **同进程编排级续跑**:回合中串行主区 Worker 命中审批暂停 → 保存编排状态(plan/round/allCollected/两套 seen 集合/budget + 被暂停 worker 实例引用)→ `kernel.agent.approve` **路由到 `orchestrator.resume`** → 从原状态续跑,**不重 plan、不重复派发**;多次暂停-恢复成链。`agent-runtime` **一行未改**。
- **5 处状态一致性硬约束**:① `maxRounds`=总 dispatch 回合数(=1 退化 C1+C2);② 结算单一来源 `allCollected`(暂停不重复计入);③ 两套集合 `seenSubtaskIds`(id 唯一)/ `seenFp`(无进展守卫,防换 id 原地打转)不混用;④ `validateReplan` 严格(id 跨轮唯一、依赖只指 completed/同轮、不依赖 failed 除非 `corrective_for`);⑤ `done:true` 仅停派发不代表成功,终判恒由 `classifyOutcome` 依 collected 判(完成/部分完成/未完成)。
- 默认零回归(`maxRounds=1` 或无 `replan`/首轮 `done` → 单轮 == C1+C2)。`config.orchestration.maxRounds`(默认 2)可配,replan 调用计入聚合预算。
- 8 任务 TDD(全程主控内联);测试 **644 全绿**(含真链路 e2e:supervised 编辑暂停→`kernel.agent.approve` 续跑到完成、`plan` 仅调 1 次)、check OK。计划:[`plans/backend/2026-06-27-v3-phase-c5-replan-resume.md`](plans/backend/2026-06-27-v3-phase-c5-replan-resume.md);设计:[`specs/backend/2026-06-27-v3-phase-c5-replan-resume-design.md`](specs/backend/2026-06-27-v3-phase-c5-replan-resume-design.md)。

### 已落地 — Phase C3 并行 Worker 写隔离(fs 拷贝 + 回放合并)
- **无依赖 + 声明范围不重叠**的子任务**并行**执行:每个并行 Worker 在 **fs 拷贝隔离工作区**(排除 `.git`/`node_modules`/`.deepseek-code`)里改动,完成后经**快照一致性校验 + 每 subtask 原子事务**回放合并进主工作区。`maxParallelWorkers=1` 或批大小=1 → 与 C1+C2 串行**逐字节一致**(零回归)。
- **机制**:fs 拷贝(非 git worktree)抓当前精确状态含脏改动;`buildToolPlane(root)` 给每个隔离区一套绑定该目录的工具平面(`agent-runtime` 仍**一行未改**);合并 = 整文件净 diff 经主 `editService.apply`(事务 + change 记录 + 可回滚)。
- **五条硬约束**:① 每 subtask 一次原子事务、批次部分成功(非整批 all-or-nothing);② 快照 CAS(合并前校验主区 path hash==base,被改过→冲突回滚标失败);③ 实际写入范围校验(不信 `context_scope.files`,扫实际 diff + 批内不重叠);④ 路径归一化严格(Windows 大小写/分隔符/目录包含/create-delete-rename);⑤ 零残留(`finally` retry+backoff 删拷贝 + run 目录、启动 owner/TTL 清扫不误删活跃 run)。
- **降级永不崩**:工作区文件数 > `maxCopyFiles` / 拷贝失败 → 该子任务失败诚实上报。`config.orchestration.parallel`(`maxParallelWorkers:4` / `maxCopyFiles:5000` / `sweepTtlMs:1h`)可配,无 on/off(=1 即关并行)。
- 8 任务 TDD(全程主控内联);测试 **618 全绿**(含真链路 e2e:两隔离 Worker 改不同文件→合并主区→零残留)、check OK。计划:[`plans/backend/2026-06-27-v3-phase-c3-parallel-isolation.md`](plans/backend/2026-06-27-v3-phase-c3-parallel-isolation.md);设计:[`specs/backend/2026-06-27-v3-phase-c3-parallel-isolation-design.md`](specs/backend/2026-06-27-v3-phase-c3-parallel-isolation-design.md)。

### 已落地 — Phase C1+C2 多智能体编排(统一入口 + 两级审核)
- **单 / 多 agent 合并为一条路**:唯一入口 `kernel.send()` → **确定性路由器**(升级 `classifier`,启发式、无模型调用、无 on/off 开关)判复杂度;简单任务走今天的 `agentRuntime.send()`(**逐字节零回归**),复杂任务走 **Orchestrator**(Planner 模型拆任务 → **串行** Worker 执行 → 两级审核 → Synthesizer 汇总)。
- **Worker / Reviewer = `agent-runtime` 实例**(注入工具子集 + 作用域上下文),编排层只在公开边界 `send()` 之上组合 —— **`agent-runtime.js` 一行未改**。**两级审核**:关卡1 子自审(复用 Worker 内置验证-修复)+ 关卡2 **独立 Reviewer**(只读工具,物理不可改,出结构化 `Verdict`)。
- **编排确定性**:派/收/打回由程序逻辑读结构化结果(`status` / `verdict.pass`),模型只在 planner/worker/reviewer/synth 节点内被调;打回有界重试,失败子任务诚实标记。
- **成本闸常开**(替代 opt-in 闸):`maxSubtasks` / `maxWorkerAttempts` / 聚合预算命中即**优雅停止 + 部分完成**,不抛不崩。`config.orchestration` 可配(router 阈值 / 上限 / 预算),CLI/GUI 经 `kernel-options` 透传。
- 子代理事件嵌入会话时间线(`orchestration:routed/planned/subtask_started/subtask_reviewed/completed`)。**非目标(留后续片)**:C3 并行写隔离、C4 经验记忆、C5 重规划、编排级 durable 恢复。
- 12 任务 TDD(全程主控内联,无 429/联网依赖);测试 **594 全绿**、check OK。计划:[`plans/backend/2026-06-27-v3-phase-c1-c2-orchestration.md`](plans/backend/2026-06-27-v3-phase-c1-c2-orchestration.md);设计:[`specs/backend/2026-06-27-v3-phase-c1-c2-orchestration-design.md`](specs/backend/2026-06-27-v3-phase-c1-c2-orchestration-design.md)。

### 已落地 — Phase B 语义级上下文引擎(首版,opt-in)
- 在文件级上下文之上加**符号层**([`src/context/semantic/`](../src/context/semantic/)):web-tree-sitter(WASM,`optionalDependencies`,仅启用时懒加载)解析 JS/TS → 符号表 + import/export 绑定 + **尽力静态调用图**(直接调用 `resolved`;`obj.method()` / 动态调用 `unresolved`,每条边带 `confidence` / `reason`)→ symbol-selector 从种子符号沿依赖图扩 N 跳、按预算选符号级片段。
- **opt-in**:`context.semantic.enabled` 默认关;关闭时单元 / 事件 / 快照与文件级**逐字节一致**(`disabled-parity` 回归守护)。provider / grammar 不可用则回退文件级,**永不崩**。
- **依赖口径软化**:README「零运行时依赖」→「核心 CLI 无必需运行时依赖;可选语义上下文按需引 WASM tree-sitter,无原生构建依赖」。
- 15 任务 TDD(联网装依赖一步交 codex,其余主控内联);web-tree-sitter `0.20.8` + 随仓 JS/TS/TSX grammar wasm。测试 **535 全绿**、check OK。计划:[`plans/backend/2026-06-26-v3-phase-b-semantic-context.md`](plans/backend/2026-06-26-v3-phase-b-semantic-context.md);设计:[`specs/backend/2026-06-26-v3-phase-b-semantic-context-design.md`](specs/backend/2026-06-26-v3-phase-b-semantic-context-design.md)。

### 已落地 — Phase B+1 方法消歧(--include-method-hints,opt-in)
- member 调用 `obj.method()` 在项目内**恰好一个同名可调用符号**(`function`/`method`/`variable`,排除 `class`)时升级为 `confidence:"probable"` 边(唯一匹配,低误报);多个 / 零个维持 `unresolved`。`member_property` 抽取边界:计算成员 `obj["x"]()` 归 dynamic、不提示。
- `neighbors` 返回 `Map<id,confidence>`(`callEdges` 始终保留完整 confidence);selector 把 probable 邻居置 priority 3 / `graph-neighbor-probable`,预算紧时让位给确定上下文。
- 新增 CLI `--semantic-context`(启用)/ `--include-method-hints`(隐含启用 + 提示),CLI 覆盖 config;**仅传 flag 才产生覆盖**,守 `disabled-parity`。默认关、关闭时行为逐字节不变。
- 6 任务 TDD(全程主控内联);测试 **549 全绿**、check OK。计划:[`plans/backend/2026-06-26-v3-phase-b-plus1-method-hints.md`](plans/backend/2026-06-26-v3-phase-b-plus1-method-hints.md);设计:[`specs/backend/2026-06-26-v3-phase-b-plus1-method-hints-design.md`](specs/backend/2026-06-26-v3-phase-b-plus1-method-hints-design.md)。

### 已落地 — Phase B+3 扩语言(query 统一抽取 + Python,opt-in)
- **抽取层统一到 tree-sitter query**:新增通用 `query-extractor`(`query.matches()` 分组组装 + 规范**字节序**排序 + enclosing-symbol 最小范围/优先级 tie-break + 单文件 `ok:false` 降级)+ 每语言定义 [`languages/<lang>.js`](../src/context/semantic/languages/) + `language-registry`;`provider.compileQuery` 编译缓存 `Query`。`ParseResult` 契约不变 → `dependency-graph` / `symbol-selector` **零改**。
- **JS / TS 等价迁移(shadow parity)**:JS/TS 语言定义在迁移期对旧 `js-ts-extractor` 逐语料做**多重集 parity**(`symbols`/`imports`/`exports`/`calls`/`symbol_id` 全等),先切默认到 query、验证等价后**退役旧 extractor**(M6),`query-extractor` 为唯一抽取路径。维持不建模项不变(匿名 `export default`、`export *`、CJS 导出、TS `interface`/`type`)。`symbol_id` 仍 `${file}#${kind}:${name}:${start_line}` 不改(排序键单独用字节偏移,不进 id)。
- **首发 Python**:模块级 function/class `exported:true`、class 内 method `exported:false`(`_private` 静态可见、不按命名约定过滤);import 四形态(`import os`/`import a.b as c`/`from . import x`/`from pkg.mod import d`);**尽力静态模块解析**(相对 `.`/`..`、绝对按有效根、`__init__.py` 包、无 `__init__` 的 namespace 目录 → external);**`importRoots` 追加语义**(`[]` ≡ `[projectRoot]`,有效根 = `[projectRoot, ...importRoots]`)。`semantic-engine` 按 `language` 派发模块解析器;跨文件绑定靠 `exported` 符号回退(Python 无 export 语句)。
- **配置**:`context.semantic.languages`(默认 `["js","ts","py"]`,白名单去重)+ `importRoots`(默认 `[]`,字符串去空)。随仓 vendored `tree-sitter-python.wasm`(web-tree-sitter `0.20.8` 兼容,联网取一步主控内联完成)。
- 12 任务 / M1–M6 TDD(全程主控内联,vendor python.wasm 联网一步亦内联完成):测试 **559 全绿**、check OK。**默认语义仍关、`disabled-parity` 守护**——关闭时行为逐字节不变。计划:[`plans/backend/2026-06-26-v3-phase-b-plus3-multi-language.md`](plans/backend/2026-06-26-v3-phase-b-plus3-multi-language.md);设计:[`specs/backend/2026-06-26-v3-phase-b-plus3-multi-language-design.md`](specs/backend/2026-06-26-v3-phase-b-plus3-multi-language-design.md)。

### 已落地 — V2-18c 编辑/回滚事务日志(V2-18 完整收口)
- 把事务日志库接入 edit/rewind:写文件前 `open()`、成功 `commit()`、失败 `abort()`(恢复 preimage);rewind 捕获 `rewind_branch_state`。`recoveryJournal` 默认 `null` → **不启用恢复时 edit/rewind 行为逐字节不变**。
- recovery-service 启动扫描 open/aborting/committed/corrupt 日志并入收件箱;暴露 `abortJournal`/`commitJournal`;kernel facade 同步暴露。
- index.js 在恢复启用时构造 journal 并注入 edit/rewind(带 lock-owner 守卫)。
- 来源:移植 worktree 工作目录中当年未提交的 V2-18c 实现(edit/rewind 直采,recovery-service 取 journal+paused 超集)。测试 **507 全绿**、check OK。
- **至此 V2-18 完整**:暂停恢复(a/b)+ 编辑/回滚事务日志(c),均 opt-in。

### 已落地 — V2-18a/b 持久化暂停恢复(整合进 main)
- 把 V2-18 恢复子系统从独立 worktree 分支**移植进 main**:项目锁 + epoch fencing、暂停 sidecar 持久化、恢复收件箱、恢复服务 + 启动扫描、CLI `/recovery`、agent-runtime durable pause/resume。
- **移植方式**(非 git merge——分支早于 V2-20/文档重组,深度分歧):① 恢复库 8 文件 + 72 单测直接落(纯新增);② 5 个核心文件(index/agent-runtime/executor-loop/repair-loop/repair-executor)用 **git 三方合并**(LF 统一空间)调和"恢复 ⊕ V2-20",手工解决 8 处真冲突(modelTimeoutMs/maxToolCallRepairs/budget ⊕ permissionContext);③ 5 个 main 未分歧文件(paused-turn-store/event-types/kernel-runner/render-events/gui-adapter)直取。
- **opt-in**:`recovery.enabled` 默认关闭(沿用 V2-20 护栏模式),**main 默认行为不变**;`createKernel(root,{ recovery:{ enabled:true } })` 启用。新增 `kernel.dispose()` 幂等释放项目锁。
- 端到端验证:暂停 sidecar 持久化 + facade 重水化/恢复 + 损坏隔离 + consumed/denied;测试 **501 全绿**、check OK。

### 已落地 — V2-19 删除 V1 legacy 架构
- 删除与 V2 并存且无引用的 V1 代码:`src/agent.js`、`src/chat.js`、`src/ui.js`、`src/kernel/*`(整套 V1 内核)、`test/kernel/*`;`config.js` 去除无消费者的 `DEFAULT_MODEL_PROFILES` re-export;`package.json` check 脚本移除对应条目。
- 共 ~2431 行死代码移除;在用命令(`scan`/`search`/`diff`/`changes`/`rollback`/`config`/`tui`)及其依赖模块全部保留,**功能不受影响**(CLI `help`/`config show` 启动正常)。
- 计划:[`plans/backend/2026-06-25-v2-19-delete-v1-legacy.md`](plans/backend/2026-06-25-v2-19-delete-v1-legacy.md);测试 417 全绿、check OK。

### 已落地 — V2-20a 运行时成本与超时护栏
- **成本闸**:新增 `src/core/runtime/cost-budget.js`(token / 模型调用数上限);接入 `executor-loop`(每轮模型调用前检查、调用后 `recordModelResult()`)与 `agent-runtime`(每个工具循环 turn 建一个预算)。
- **模型调用超时**:`model-gateway` 的 `invoke`/`stream` 支持 `options.timeoutMs`,超时抛 `MODEL_TIMEOUT`(调用方 signal 与超时合并)。
- **工具调用超时**:`tools/executor` 支持 `defaultToolTimeoutMs` / `context.toolTimeoutMs`,超时落为标准 `status:"error"` 结果(`metadata.timeout=true`,不抛、不强杀进程)。
- **kernel 配置**:`createKernel(root, { limits: { maxTurnTokens, maxModelCalls, toolTimeoutMs } })` 透传;全部默认 `null`(护栏关闭),现有行为不变。
- 计划:[`plans/backend/2026-06-24-v2-20a-runtime-cost-timeout-guardrails.md`](plans/backend/2026-06-24-v2-20a-runtime-cost-timeout-guardrails.md);测试 529 全绿。

### 已落地 — V2-20b 护栏注入与优雅停止
- **优雅停止**:成本超限由抛 `BUDGET_EXCEEDED` 改为让 turn 干净结束 —— `executor-loop` 命中预算返回 `status:"stopped"`,`agent-runtime` 将其作为 turn 终态(发 `agent:final` status=`stopped`,跳过 verify/repair,`send()` 正常返回 `{ status:"stopped", content, budget }`)。
- **modelTimeoutMs 注入**:`modelTimeoutMs` 经 runtime 透传到 `executor-loop`(run+resume)每次 `invoke` 与 `gateway.reply` 内部 invoke;`createKernel` 由 `options.limits.modelTimeoutMs` 注入。至此 kernel `limits` 四参齐全(`maxTurnTokens` / `maxModelCalls` / `toolTimeoutMs` / `modelTimeoutMs`)。
- 计划:[`plans/backend/2026-06-25-v2-20b-guardrail-injection-graceful-stop.md`](plans/backend/2026-06-25-v2-20b-guardrail-injection-graceful-stop.md);测试 531 全绿。

### 已落地 — V2-20c 畸形 tool-call 有界重试
- **失败重试**(补完坑 #5):模型吐出参数非合法 JSON 的 tool-call(`adaptDeepSeekToolCalls` 抛 `invalid tool arguments`)时,`executor-loop`(run+resume)不再让 turn 直接失败,而是回灌一条纠正消息并重发,最多 `maxToolCallRepairs` 次,每次发 `model:tool_call_repair` 事件;超出才抛原错。
- **透传**:`createAgentRuntime` 新增 `maxToolCallRepairs`,工具循环传给 `runExecutorLoop`;`createKernel` 由 `options.limits.maxToolCallRepairs` 注入。默认 `0`(立即抛错,行为不变)。至此 kernel `limits` 五参齐全(`maxTurnTokens` / `maxModelCalls` / `toolTimeoutMs` / `modelTimeoutMs` / `maxToolCallRepairs`)。
- 计划:[`plans/backend/2026-06-25-v2-20c-malformed-toolcall-retry.md`](plans/backend/2026-06-25-v2-20c-malformed-toolcall-retry.md);测试 535 全绿。

### 已落地 — V2-20d resume 路径护栏对齐
- **审批 resume 不再裸跑**:`approve()` 的 `resumeExecutorLoop` 调用此前不带任何护栏。现在在 resume 段新建成本预算,并透传 `budget` / `modelTimeoutMs` / `maxToolCallRepairs`(取 `resume_state.options` 覆盖 + 工厂配置);至此正常工具循环与审批 resume **护栏一致**。
- **stopped 终态**:resume 段预算超限返回 `status:"stopped"` 时,`approve()` 镜像 `send()` 作为 turn 终态处理(发 `agent:final` status=`stopped`,返回 `{ status:"stopped", content, budget }`),不再误入 verify/repair。
- 预算为 resume 段**新建**(审批暂停为天然边界,不继承暂停前花费);repair-context 子路径的预算对齐留待 V2-20e。
- 计划:[`plans/backend/2026-06-25-v2-20d-resume-path-guardrail-alignment.md`](plans/backend/2026-06-25-v2-20d-resume-path-guardrail-alignment.md);测试 536 全绿。

### 已落地 — V2-20e repair 路径模型超时
- **repair 不再可永久挂起**:`runRepairExecutor` 的模型调用现在设 `timeoutMs`(`modelTimeoutMs ?? options.timeoutMs`);`runRepairLoop` 透传 `modelTimeoutMs`;`agent-runtime` 在两处 repair 调用点(verify 路径 + 审批 repair_context)注入。至此 `modelTimeoutMs` 覆盖**全部三条模型调用路径**:正常工具循环、审批 resume、验证-修复。
- **范围(YAGNI)**:repair 路径的成本预算 / tool-call 重试**显式延后**(已被 `maxRepairAttempts` 限轮,边际价值小)。护栏 plumbing 至此完整。
- 计划:[`plans/backend/2026-06-25-v2-20e-repair-path-model-timeout.md`](plans/backend/2026-06-25-v2-20e-repair-path-model-timeout.md);测试 538 全绿。

### 已落地 — V2-20f 护栏默认值与用户配置
- **护栏点亮**:工具/模型超时**默认 120s 开启**;`DEFAULT_CONFIG.limits` 成为默认值单一来源,`normalizeConfig`/`loadConfig` 深合并用户 `limits`(per-field,`null`/`≤0` 关闭),两个超时另支持 `DEEPSEEK_TOOL_TIMEOUT_MS` / `DEEPSEEK_MODEL_TIMEOUT_MS` 环境覆盖。
- **双入口转发**:CLI 与 GUI 的 `buildKernelOptions` 都把 `config.limits` 透传给 `createKernel`;token/调用预算与 tool-call 重试默认关、可配。
- **配置哲学**:在适配 DeepSeek 前提下参数尽量交给用户——默认值只给安全起点,不锁死(详见根 README「运行护栏与配置」)。
- 计划:[`plans/backend/2026-06-25-v2-20f-guardrail-defaults-config.md`](plans/backend/2026-06-25-v2-20f-guardrail-defaults-config.md);测试 544 全绿。

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

## V1 — 原始实现(legacy,**已于 V2-19 删除**)

> V1 并存架构已删除。`scan` / `search` / `diff` / `config` / `changes` / `rollback` / `resume` / `tui` 等命令照常可用——它们依赖的工具模块(`context`/`search`/`git`/`patch`/`changes`/`provider`/`tui`/`theme`/`config`)已作为 V2 共享依赖保留,**不属** legacy。

- 终端 AI 编程 agent:`ask` / `edit` / `chat`、项目上下文扫描、unified diff 应用与回滚、DeepSeek 直连、Git 差异、项目搜索。
- `src/kernel/*` V1 内核抽象层:EventBus、SessionLog(append-only + 哈希链)、ConfigProvider、ModelProvider、ContextEngine、TaskOrchestrator、PermissionEngine、ToolRegistry、SessionManager。
- Electron GUI 脚手架(安全 IPC、Surface/Context/Control 三层、XSS-safe 渲染)。
- 安全基线:workspace 边界 realpath 校验、SSRF 防护、shell 结构化 argv、secret 脱敏。
