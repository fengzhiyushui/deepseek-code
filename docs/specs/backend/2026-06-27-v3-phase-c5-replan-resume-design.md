# DeepSeek Code V3 Phase C5 · 重规划 + 持续派发回合循环(同进程编排级续跑)设计

> 类型:后端设计 spec(backend)
> 日期:2026-06-27
> 状态:已评审,待转实施计划(writing-plans)
> 关联:[C1+C2 多智能体编排](2026-06-27-v3-phase-c1-c2-orchestration-design.md) · [C3 并行写隔离](2026-06-27-v3-phase-c3-parallel-isolation-design.md) · [V3 路线图](../architecture/2026-06-24-v3-roadmap-design.md) §7.3

---

## 1. 背景与目标

C1+C2+C3 已落地:`orchestrator.run` **规划一次** → `dispatch-loop` 跑完所有子任务(并行批由 C3 处理)→ Reviewer 打回只做有界 worker 重试,耗尽即标失败。

**C5 目标(roadmap §7.3 本次任务内自主优化)**:
1. **重规划**:子任务反复失败/被打回 → Orchestrator 看审核摘要后**调整拆法**(补/改子任务、换策略),而非直接放弃。
2. **持续派发**:长任务"派一批 → 看审核摘要 → 再派新一批",直到完成 / 预算耗尽 / 回合上限。
3. **同进程编排级续跑**:回合中 worker 命中审批暂停 → 保存**完整编排状态** → `approve` 后**从原状态接着跑**(不重 plan、不重复派发)。

**统一抽象**:把"规划一次→派发一次"一般化为**确定性回合循环**;每回合后调 `planner.replan(摘要) → { done, subtasks }` 产出下一批(纠正/继续/完成)。**模型只产结构化下一批,程序闸控制终止**。

**延续约束**:`agent-runtime.js` 一行不改;编排确定性;成本闸常开;**默认零回归**(`maxRounds=1` 或无 `replan`/`replan.done` → 退化 C1+C2);C4 跨任务经验记忆**不在本片**(replan 只用本次任务内的 completed/failed 摘要)。

---

## 2. 范围与非目标

**做**:确定性回合循环 · `planner.replan` + `validateReplan`(严格 schema)· 无进展守卫(fingerprint)· `done` 建议 + 确定性终止闸 · **同进程编排级续跑**(暂停保存编排状态 + `approve` 路由到 orchestrator + 从原状态续跑,不重 plan)· 终判 完成/部分完成/未完成。

**不做(留后续)**:**跨进程 durable 恢复**(崩溃重启后从第 k 轮续 —— 即「编排级 durable 恢复」基础设施,本片只同进程内存续跑)· C4 跨任务经验记忆 · 并行 iso worker 的审批门(iso worker 仍 `auto`,见 §4.6)· merge 步骤审批门。

---

## 3. 回合循环(确定性)

```text
plan = planner.plan({ message, context })          # 初始规划(不变)
state = { plan, round: 1, allCollected: [], seen: Set, budget }
loop:
   result = runDispatchLoop(state.plan.subtasks, ...)   # 复用 C1+C2+C3(内部该并行并行)
   state.allCollected += result.collected
   if result.status == "awaiting_approval":
       保存 state + result.resume(见 §5)→ 返回 awaiting_approval   # 同进程续跑入口
   # —— 确定性终止闸(程序逻辑,非模型) ——
   if state.round >= maxRounds:           break  # 回合上限
   if budget.exceeded():                  break  # 预算
   nextInput = summarize(state.allCollected)      # completed / failed 摘要
   next = await planner.replan({ message, done_when: plan.done_when, completed, failed })
   gate = decideContinue(next, state)             # §4.5 确定性闸
   if !gate.continue:                     break   # done / 无进展 / 空
   state.plan = { subtasks: gate.subtasks }       # 下一批(已过 validateReplan + fingerprint 去重)
   state.round += 1
final = synthesizer({ message, collected: state.allCollected })   # 终判 完成/部分完成/未完成
return { status, content: final, collected: state.allCollected }
```

`runDispatchLoop` 每回合跑"当前这批子任务"(其内部按 C3 决定并行/串行)。回合数、终止、预算全由 **orchestrator 程序逻辑**判;`replan` 只是被调的模型节点。

---

## 4. 硬约束(实施判据)

### 4.1 `maxRounds` 语义(写死)
`maxRounds` = **总 dispatch 回合数**(初始轮计 1)。`maxRounds:2` = 初始派发 + 1 次 replan + 第 2 轮派发;**`maxRounds:1` = 严格退化 C1+C2**(只初始轮,不 replan)。默认 `2`。

### 4.2 `replan` 契约
`planner.replan({ message, done_when, completed, failed }) -> { done: boolean, subtasks: SubTask[] }`。`completed`/`failed` 为**摘要**(id + goal + 简短结果/根因,不灌全文)。模型畸形输出 → 有界重试(同 `plan`);仍失败 → 视作 `{ done:true, subtasks:[] }`(保守收尾,不崩)。

### 4.3 `validateReplan` 严格 schema
每轮新 `subtasks` 过 `validateReplan(subtasks, { seenIds, completedIds })`:
- **id 跨轮全局唯一**(不得撞 `seenIds` = 历轮所有 id)。
- `depends_on` 只能指向 **`completedIds`** 或 **本轮 id**;**不得依赖 failed 任务**,除非该 subtask 标 `corrective_for: <failedId>`(显式纠正)。
- `tool_profile` / `context_scope` 必给(喂 C3 批次划分)。
- 违规 → 该轮 replan 视为无效 → 终止循环(不带病续派)。

### 4.4 无进展守卫(程序化)
`fingerprint(st) = normalize(goal + sorted(context_scope.files) + tool_profile)`。维护 `seen` 指纹集。某回合**零新增 completed** 且 **replan 的 subtasks 指纹全部已在 `seen`** → 判**无进展** → 停(防模型换 id 原地打转)。新 subtask 入队前其指纹加入 `seen`。

### 4.5 终止闸 `decideContinue(next, state)`(`done` 不放权给模型)
程序逻辑综合判,**全部满足才继续**:
- `next.done !== true`(模型未宣告完成),**且**
- `next.subtasks` 非空且过 `validateReplan`,**且**
- 非无进展(§4.4),**且**
- `state.round < maxRounds` 且 `!budget.exceeded()`。
否则停。模型说 `done:true` → 直接停(达成);但**即使模型说没 done**,程序闸(预算/轮数/无进展)也能停。

### 4.6 暂停点与续跑边界(让续跑可做)
- **唯一审批暂停点 = 单任务批的主区 Worker**(串行)。并行 iso Worker 仍 `autonomy:"auto"`(隔离拷贝内改,不暂停);merge 直落主区(不走审批门)。**本片不改这点**(并行/merge 审批门留后续)。
- ⇒ 暂停**永远在串行边界**,编排状态干净:无"并行批跑一半卡审批"的半场。续跑只需处理**串行维度**。

### 4.7 默认零回归
`maxRounds=1`,**或** `planner` 无 `replan`,**或** `replan` 第一轮即 `done` → 循环第 1 轮后停 == C1+C2。现有 orchestrator/dispatch/e2e 测试(mock planner 只有 `.plan`)**照绿**。

---

## 5. 同进程编排级续跑

### 5.1 暂停时保存(内存)
回合内某主区 Worker `awaiting_approval` 冒泡时,`dispatch-loop` 返回 `resume`(本回合续跑所需):

```text
roundResume = {
  pausedWorker,            // 该 worker 的 runtime 实例(同进程,持 JS 引用即可)
  pausedApprovalId,        // = worker 的 approval.id(用户解决的就是它)
  pausedSubtask,
  remaining,               // 本回合在暂停点之后未派的批/子任务
  roundCollected           // 本回合已结算的条目
}
```

`orchestrator` 把**编排状态**连同 `roundResume` 存进**内存 paused 表**(键 = `pausedApprovalId`):

```text
orchPaused[approvalId] = { message, plan, round, allCollected, seen, budget, roundResume }
```

返回 `{ status:"awaiting_approval", approval, collected: allCollected }` 上浮。

### 5.2 恢复(`approve` 路由)
`kernel.agent.approve(id, decision)`:**先查 `orchestrator.hasPaused(id)`** → 是则 `orchestrator.resume(id, decision)`;否则 `runtime.approve(id, decision)`(单 agent 原路)。

`orchestrator.resume(id, decision)`:
1. 取 `orchPaused[id]`;删除该条(消费)。
2. `decision==="deny"` → 该 subtask 标失败;否则 `pausedWorker.approve(pausedApprovalId, "approve")` → 拿结果 → 结算该 subtask(经 settle/merge,同正常路径)。
3. **续跑本回合的 `remaining`**(经 `resumeDispatchLoop(roundResume, ...)`)→ 得本回合完整结果。
4. **接着跑回合循环**(§3,从 `round`/`allCollected`/`seen`/`budget` 续)——**用保存的 plan,绝不重新 `planner.plan`**。
5. 跑到完成 / 下一个暂停(再存 `orchPaused`)/ 预算 / 轮数 → 返回。

### 5.3 关键不变量
- **不重 plan**:续跑用保存的 `plan` 与 `round`;只有到达回合边界才调 `replan`。
- **不重复派发**:已结算的子任务在 `allCollected`/`roundCollected`,续跑只处理 `remaining`。
- **同进程**:`pausedWorker` 是内存中的 runtime 实例,直接 `approve` 续其 turn——无需持久化 worker 状态。
- **崩溃不保**(本片非目标):进程退出 → 内存 paused 表丢失;跨进程 durable 留「编排级 durable 恢复」片。

---

## 6. 组件

| 单元 | 改动 |
|------|------|
| `planner.js` | 加 `replan({ message, done_when, completed, failed }) -> { done, subtasks }`(模型 + 校验 + 重试 + 保守收尾) |
| `subtask-schema.js` | 加 `validateReplan(subtasks, { seenIds, completedIds })`(§4.3)+ `fingerprint(st)`(§4.4) |
| `dispatch-loop.js` | `runDispatchLoop` 暂停时返回 `resume`(§5.1);新增 `resumeDispatchLoop(roundResume, deps)` 续本回合 remaining |
| `orchestrator.js` | `run` 包成回合循环(§3)+ 终止闸(§4.5)+ 暂停存 `orchPaused`;新增 `resume(id, decision)`(§5.2)、`hasPaused(id)` |
| `synthesizer.js` | 终判 **完成 / 部分完成 / 未完成**(读 allCollected:全 complete=完成;有 failed 且停=部分;预算/轮数耗尽未尽=未完成) |
| `config.js` | `orchestration.maxRounds`(默认 2)归一化 |
| `index.js` | `agent.approve` 路由:`orchestrator.hasPaused(id) ? orchestrator.resume : runtime.approve` |

`agent-runtime.js` **不改**(worker 暂停/恢复用其现成 `send`/`approve`;orchestrator 持 worker 实例引用续跑)。

---

## 7. 配置

```text
config.orchestration.maxRounds = 2     // 总 dispatch 回合数;1 = 退化 C1+C2;replan 调用计入聚合 budget
```
`normalizeOrchestration` 加 `maxRounds`(posInt,默认 2)。无独立 on/off(=1 即关 replan)。

---

## 8. 事件
- `orchestration:round_started` —— `{ round, subtasks }`
- `orchestration:replanned` —— `{ round, done, new_subtasks }`
- `orchestration:completed` 扩展 —— `{ rounds, completed, failed, status: "complete"|"partial"|"incomplete", stopped_reason }`
仅 orchestrate 档触发(single 档不变)。

---

## 9. 测试策略(node:test,确定性优先)

- **validateReplan**:id 跨轮唯一/撞 seen 拒;依赖 completed/同轮 OK、依赖 failed 拒(corrective 例外);缺 scope/profile 拒。
- **fingerprint / 无进展**:换 id 同指纹 → 判无进展停。
- **planner.replan**:mock 模型 → 合法 `{done,subtasks}`、畸形重试、保守收尾 `done:true`。
- **回合循环**(mock planner.plan + replan + mock dispatch):①失败 → replan 补纠正 → 第 2 轮过;②全 complete + replan done → 1 轮停;③`maxRounds` 封顶;④预算耗尽停;⑤无进展停;⑥`maxRounds=1` == 单轮(零回归)。
- **终止闸**:模型 `done:true` 停;模型不 done 但预算/轮数到 → 程序闸停;部分失败 → synthesizer 报"部分完成"。
- **同进程续跑**(核心):mock 一个主区 worker 第一次 `awaiting_approval`;`orchestrator.resume(id,"approve")` → 续 remaining + 后续回合;断言**不重 plan**(planner.plan 调用次数=1)、**不重复派发**(已派子任务不重跑)、最终完成。`deny` → 该 subtask 失败、循环继续。
- **kernel approve 路由**:编排审批 id → orchestrator.resume;非编排 id → runtime.approve(单 agent 不受影响)。
- **回归**:现有 618 全绿(planner 无 replan / maxRounds 默认下,mock-only-`.plan` 测试退化单轮)。

---

## 10. 里程碑(供 writing-plans 拆)

```text
M1  subtask-schema:validateReplan + fingerprint + 单测
M2  planner.replan(模型→{done,subtasks} + 校验 + 重试 + 保守收尾)+ 单测(mock 模型)
M3  config.orchestration.maxRounds 归一化 + 透传 + 单测
M4  dispatch-loop:暂停返回 roundResume + resumeDispatchLoop(续本回合 remaining)+ 单测(mock)
M5  orchestrator:run 回合循环 + decideContinue 终止闸 + round/replan 事件 + 单测(mock planner/dispatch)
M6  orchestrator:同进程续跑(orchPaused 存/取 + resume(id) + hasPaused)+ 单测(暂停→resume→不重 plan/不重复派发)
M7  index.js:agent.approve 路由(orchestrator 优先)+ synthesizer 终判 + e2e(mock 模型:失败→replan→完成;暂停→approve→续跑)
M8  回归 618 全绿 + 文档(README 中英 / CHANGELOG / project-overview §14 补 C5 / docs/README 索引)
```

> M1–M6 全可 mock 纯单测;M7 才组装真链路 + kernel 路由;M8 收口。`maxRounds=1` / 无 replan 永远是零回归逃生口。

---

## 11. 开放问题(实施前/中再定)
- `maxRounds` 默认值(2 起步,实测调)。
- `replan` 摘要的压缩格式(completed/failed 各取 id+goal+一句结果/根因;防灌全文)。
- `decideContinue` 的"无进展"是否也参考"本轮主区 change 数"(MVP 用 completed 增量 + 指纹即可,主区 change 作未来增强)。
- deny 一个编排审批后:该 subtask 失败,后续回合是否允许 replan 把它当 corrective 重做(MVP:允许,按 §4.3 corrective 规则)。
