# Changelog

本文件记录 DeepSeek Code 的版本演进。**自 v1.0.0 起采用[语义化版本](https://semver.org/lang/zh-CN/)** `major.minor.patch`,命名规则与升级判定见 [`docs/README.md` 版本命名规则](README.md#版本命名规则)。

维护约定:
- **每个大版本(major)**给出该版本交付能力的**总结**;其下每个**小版本(minor)/ 补丁(patch)**各追加一条**简要日志**。
- **大版本收官后仅保留其能力总结**,不保留内部里程碑级细节——细节见 [`docs/specs/`](specs/) · [`docs/plans/`](plans/) 与 git 历史。
- 文档更新顺序见 [`docs/README.md` 文档维护规范](README.md#文档维护规范与更新顺序):代码 → specs/plans → project-overview → **本文件** → README(中+英)→ 索引。

---

## [Unreleased]

> 下一个补丁 / 小版本的变更在此累积;发布时移入带版本号的小节。

- (暂无)

**已挂账(待立项,方案见 [`specs/backend/2026-07-12-agent-findings-remediation.md`](specs/backend/2026-07-12-agent-findings-remediation.md)):** 中文意图分类(P0)、GUI 内核配置分叉(P0)、TUI/CLI 回合中断(P1)、SSRF/脱敏/ReDoS/shell 环境隔离(安全)、语义上下文静默降级可观测化、`agent-runtime.js` 可维护性重构等。

---

## v1.0.0 — 2026-07-13 · 首个正式版本

DeepSeek Code 的首个正式发布,**整合此前全部内部迭代**(V1 原型 → V2 干净运行时 → V3 三支柱)为一个统一版本。面向 DeepSeek 的**本地 AI 编程 Agent**:在你的项目目录里读代码、改代码、跑测试,并把每一步模型调用、工具执行、文件改动与审批记录成可回放、可分支、可回退的会话时间线。**CLI · TUI · 桌面 GUI 三端共用同一内核**,核心运行时零依赖(仅可选 WASM tree-sitter),Node ≥ 20 + 一个 API Key 即可运行。

### 统一内核与三端
- **一个内核门面** `createKernel()`:一条 Agent runtime、一条工具执行路径、一套编辑/回滚服务、一条会话时间线;三端只做输入 / 展示 / 审批,不碰 agent 业务逻辑。
- **回合生命周期**:意图分类 → 上下文快照 → 快答 / 工具循环 → 验证 → 按需修复,由 11 态生命周期状态机与事件总线记录(56 种规范会话事件,JSONL 追加 + sha256 哈希链)。
- **五档自治 × 八类别权限矩阵**(read-only/supervised/gated/auto/full-auto);`ask` 判定使回合整体暂停并落盘 resume_state,`approve`/`deny` 从断点精确续跑;审批以参数指纹 + TTL 缓存。
- **DeepSeek 原生适配**:按用途路由模型(reply/act/plan/review/repair/fim)、JSON mode guard、手写 SSE 流式、FIM 代码补全、tool-call 容错解析、用量遥测。
- **三端共享事件展示契约**(`src/apps/event-contract.js`):内核事件 → 归一化展示描述符的唯一语义源,CLI / TUI / GUI 渲染器均为薄适配层,字段兼容逻辑收敛一处。

### 支柱① 语义级上下文(opt-in,默认关)
- 文件级上下文引擎(默认):增量扫描 + manifest 缓存 + 路径优先级分层 + 按通道 token 预算贪心装填 + 快照缓存(KV 前缀命中提示)。
- 语义级(`--semantic-context`):基于 web-tree-sitter(WASM,无原生构建)按符号(函数/类)检索,沿 import / 调用依赖图扩展;**支持 JS / TS / Python**;方法消歧 `--include-method-hints`(唯一同名 → probable)。关闭时与文件级逐字节一致。

### 支柱② 多智能体调度(默认开,简单任务零开销)
- **分层路由器**:明显档免费启发式直判,模糊中间档调一次便宜模型判复杂度(`router.model.enabled=false` 可退回纯启发式)。
- **编排闭环**:Planner 拆子任务 → 串行 Worker 执行 → **两级独立审核**(子自审 + 只读 Reviewer)→ Synthesizer 合成;失败/不完整多回合自适应重规划;成本闸常开。
- **并行写隔离**:无依赖且文件不重叠的子任务在 fs 拷贝隔离工作区并行,快照一致性校验 + 每子任务原子事务合并回主区,零残留。
- **跨任务经验记忆**(`crossTaskLearning`,默认 off):独立经验库 + 三级分化衰减 + Jaccard 去重,风险经验单调升级权限(只 allow→ask)。
- **持久化恢复**(`recovery.enabled`,默认关):进程崩溃后凭项目锁 + 事务日志 + 暂停 sidecar 恢复未完成回合,含**跨进程编排级**续跑。

### 支柱③ 前端三端
- **桌面 GUI**(Electron + React + Vite,**原创手写 VS Code 风格设计系统**,不用成品 UI 套件;双语 zh/en 默认中文):真文件树 · Monaco 编辑器(本地 worker)· node-pty 交互终端 · 设置页(API 列表管理 / 模型获取 / 编辑保存 / 分支切换 / 检查点 rewind)· SCM「AGENT 改动」跟踪(前后对比 + hunk 跳转)。渲染层沙箱化,仅经 preload 白名单 IPC 通信。
- **终端 TUI**(claude code 式行内滚动流):历史进终端原生滚动区,底部固定输入 / 状态栏;流式打字机预览 · 工具/diff/审批/编排卡片 · slash 命令补全 · `/config` 与 GUI 共享 API 列表(激活重建 kernel 保上下文);手写 ANSI/VT,双语。
- **CLI**:`ask / chat / edit / test / scan / search / diff / config / changes / rollback / tui` 子命令;chat REPL 含 `/mode` `/recovery`(resume/cancel/clear);多 agent 编排摘要;`/recovery` 与 TUI 对齐。

### 安全基线
- workspace 边界 realpath 校验 · shell 结构化 argv(无 shell 注入面)· web_fetch SSRF 防护(私网/回环封锁 + 每跳重校验)· 密钥脱敏 · GUI 沙箱化 · API Key 明文只落随仓忽略的 `.deepseek-code/`、渲染路径只出现掩码。

### 运行护栏
- 工具/模型调用超时默认 120s 开启;token、模型调用次数、畸形 tool-call 重试均可配额;命中后优雅停止而非崩溃。

### 质量
- **932 测试全绿**(node:test 原生),`npm run check` 通过;支柱①②③ 前端与编排全程守「kernel 核心 `src/core`/`src/index.js` 零改动」纪律。

> **开发历程**(详见 [`docs/specs/`](specs/) · [`docs/plans/`](plans/) 与 git 历史):
> **V1 原型**(2026-05,ask/edit/chat + 安全基线,已于内部重构删除)→ **V2 干净运行时**(2026-05–06,内核地基 / 审批恢复 / 验证修复 / 上下文引擎 / 事务编辑与分支 rewind / 持久化恢复 / 运行护栏)→ **V3 三支柱**(2026-06–07,语义级上下文 Phase B、多智能体调度 Phase C、前端三端重构 Phase D + CLI 对齐 D-G4)。
>
> 注:内部架构文档中的「V2 内核」指**运行时架构代号**(干净运行时),与本文的**产品版本号 v1.x** 是两条不同的轴,不要混淆。
