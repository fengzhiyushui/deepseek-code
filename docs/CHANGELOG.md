# Changelog

本文件记录 Inkstone 的版本演进。**自 v1.0.0 起采用[语义化版本](https://semver.org/lang/zh-CN/)** `major.minor.patch`,命名规则与升级判定见 [`docs/README.md` 版本命名规则](README.md#版本命名规则)。

维护约定:
- **每个大版本(major)**给出该版本交付能力的**总结**;其下每个**小版本(minor)/ 补丁(patch)**各追加一条**简要日志**。
- **大版本收官后仅保留其能力总结**,不保留内部里程碑级细节——细节见 [`docs/specs/`](specs/) · [`docs/plans/`](plans/) 与 git 历史。
- 文档更新顺序见 [`docs/README.md` 文档维护规范](README.md#文档维护规范与更新顺序):代码 → specs/plans → project-overview → **本文件** → README(中+英)→ 索引。

---

## [Unreleased]

> 下一个补丁 / 小版本的变更在此累积;发布时移入带版本号的小节。

- **品牌改名**:产品名 **DeepSeek Code → Inkstone(砚)**。显示品牌全面替换(CLI/TUI banner、GUI 窗口与页面标题、system prompt 产品自称、User-Agent、README/docs/设计稿);结构层同步(package/bin 命令 `inkstone` + 保留 `dsc` 别名、gui 包名 `inkstone-gui`、conda 环境名)。**功能契约全部保留**:`.deepseek-code` 存储目录、`DEEPSEEK_*` 环境变量、`api.deepseek.com` 端点与 `deepseek-v4-*` 等模型 id 均不改。方案见 [`plans/architecture/2026-07-31-inkstone-rebrand.md`](plans/architecture/2026-07-31-inkstone-rebrand.md)。
- **v1.4.6 设计稿细节还原(feat/v1.4 分支)**:在 P0–P4 基础上对照 v4 设计稿逐项补齐 ——
  **图标规范**:GUI 全部改用 lucide-react 矢量图标(新增 `lucide-react` 依赖),移除残留的 emoji/几何字形(📎 ⚡ ◆ 等),删除十个旧版 IDE 组件(ActivityBar/AgentPanel/DiffView/EditorGroup/Explorer/Icons/Placeholder/RewindDialog/StatusBar/Terminal)与 `panels-derive` 死模块;
  **七视图还原**:首页改为问候语+输入胶囊+四张快捷卡+最近会话、侧栏项目分区内挂日期分组会话(今天/昨天/本周/更早)+搜索过滤(新 `session-groups.js`)、会话视图补齐五类事件卡(计划带子任务清单/工具带参数/diff 带逐文件增删/审批卡接批准与拒绝/编排卡)、设置页对齐设计稿表单语言(s-nav/f-group/f-row/.sw/主题网格/5 形态卡);
  **状态行还原**:`.cz-meta` 完整实现——分支/检查点/连接标签 + 5 形态比例指标(文字/数值/进度条/点阵/关闭,点按钮可轮换)+ 模型/主题/语言标签,由「状态显示」偏好驱动,空闲淡出;
  **能力补齐**:「打开文件夹…」原生目录选择 IPC(`projects:pick`)、项目页「在文件管理器中显示」(shell.openPath)、会话枚举跨全部登记项目(侧栏每项目分区各自挂载);
  **TUI 对齐**:启动首页菱形品牌行(版本/模型/档位/shell/主题 meta)+ 最近会话列表,状态行加 `th:` 主题标签。
  全量回归 1006 单测 + e2e ×4 通过;GUI 冒烟截图随 smoke 落 `gui/__screenshots__/`。
- **v1.4.7 前端收口(feat/v1.4 分支)**:侧栏可收放 —— Rail 272px⇄52px 图标轨,`Ctrl/⌘+B` 切换、偏好 `railCollapsed` 持久化,折叠态仅保留功能区图标与页脚「展开/设置」两钮;恢复 `DiffView.jsx` 修复 renderer 构建断裂;补齐 `Ctrl/⌘+N` 新建会话;修复 Rail 分区折叠、首页 busy 中断键、标题栏明暗主题图标(改按 `themes.js` group 判定)三处交互问题;设置页全窗化(不再与 Rail 并列,顶部新增「返回/关闭」按钮,返回原视图),窄窗口菜单栏消失修复(≤900px 时 Rail 改为强制 52px 图标轨而非隐藏);构建与测试加固(renderer-dist 门控、Electron 冒烟截图预算兜底),mimo-v2.5 截图复核 8 视图全绿(修复 smoke 设置截图选错按钮、窄屏折叠偏好残留 52px 空列、改动时间原始 ISO 显示),全量回归 1012 单测 + `npm run check` + renderer build + Electron 冒烟通过。
- **v1.4.0 前端界面重设计(已实现,`feat/v1.4` 分支)**:GUI/TUI 界面全部重做,按 [`plans/frontend/2026-07-31-v1.4.0-frontend-redesign-plan.md`](plans/frontend/2026-07-31-v1.4.0-frontend-redesign-plan.md) 的 P0–P4 落地。**设计定稿**(五轮 HTML 稿,终稿 = [`prototypes/v1.4.0-redesign/v4/`](prototypes/v1.4.0-redesign/v4/)):**10 套主题**(3 浅 7 深,色值取自 Flexoki/Rosé Pine/Catppuccin/Kanagawa/Tokyo Night/Nord/Everforest/Gruvbox Material 官方定义源,WCAG 110 项校验全过,默认 `sumi` 墨)——GUI `tokens.css` 单源 + 设置页外观 10 主题网格,TUI 经 `gen-tui-theme` 生成 xterm-256 调色板 + `/theme`。**GUI 会话优先布局**:rail 功能区(主页/项目/改动/MCP/插件)+ 每项目独立分区(内挂该项目会话,新建会话继承项目目录)+ 独立对话;七视图路由;`.cz-meta` 指标 5 形态(文字/数值/进度条/点阵/关闭)+ 全中文「状态显示」设置组;全局项目 MRU + 会话枚举(kernel 零改动)。**TUI**:opencode 式启动首页(垂直居中/单行 meta/最近会话)+ `/theme` + `/shell`(pwsh/powershell/cmd/git-bash)。

**已挂账(待立项,方案见 [`specs/backend/2026-07-12-agent-findings-remediation.md`](specs/backend/2026-07-12-agent-findings-remediation.md)):** 明文变更记录脱敏方案(#9.3,需独立 design)、`agent-runtime.js` 可维护性重构(#10)。

---

## v1.3.2 — 2026-07-29 · 语义降级可观测 & GUI 休眠渲染层删除

- **语义上下文降级可观测化(#8):** `semantic-engine.js` 在降级翻转处恰好发布一次 `context:semantic_degraded` 事件(含 error.message reason,~200 字符截断),经事件类型注册入会话时间线、`event-contract.js` 以非静默 warn kind 展示(CLI/TUI 默认行渲染即可读);粘性降级与文件级回退行为不变。
- **删除 `context.semantic.languages` 空转配置(#8):** 从 `DEFAULT_CONFIG` 与 `normalizeContext` 移除从未被消费的 `languages` 键及 `normalizeLanguages` 函数;含旧键的用户配置静默消失(`normalizeContext` 固定键集重建)。同步删除从未被加载的 `tree-sitter-tsx.wasm`(2.4 MB 死重)及 `wasm-tree-sitter-provider.js` 中的 `tsx` 条目。
- **删除 GUI 休眠渲染层(#9.6):** 整目录 `gui/renderer/`(app.js / event-adapter.js / workbench-state.js / index.html / style.css)已删除——消除问题 #5(事件→展示四份并行实现)的最后残留。`gui/main.js` 加载决策改为:dev URL → renderer-dist,两者皆无→`dialog.showErrorBox` + stderr 报错「请先运行 npm run build:renderer」+ 非零退出。删除 2 个对应单测;`npm run check` 移除了 `gui/renderer/*` 条目。
- 版本同步为 `1.3.2`(`package.json` / `package-lock.json` / CLI-TUI banner);全量回归(978 项)与语法检查通过。
- 本版范围说明:#7 命令策略已在 v1.3.1 发布;#9.3(明文变更记录)、#10(agent-runtime 重构)继续挂账。

- `shell`/`git` 子进程执行在权限档位之外新增**命令级分类**([`src/security/command-policy.js`](../src/security/command-policy.js),清单硬编码):`classifyCommand(argv)` 将命令分为 safe / dangerous / forbidden 三类,经工具 `resolveCategory` 映射进权限引擎——**forbidden**(format / mkfs* / diskpart / bcdedit / dd)映射到 `destructive`,在所有自治档位一律拒绝且审批缓存不可放行;**dangerous**(rm/del 等删除类、shutdown/reg/taskkill 等系统类、curl/wget、npm publish、git push 强制推送、bash/cmd/powershell 等包装 shell、node -e / python -c 等解释器执行参数)映射到 `execute_dangerous`,在 supervised / gated / auto / **full-auto** 四档一律要求人工确认(read-only 档拒绝,与其余 execute 一致);safe 命令行为不变。命令名归一化覆盖 basename、大小写、`.exe`/`.cmd`/`.bat`/`.com` 扩展名及 Win32 尾部点号变体。
- `runProcess` 兜底:spawn 前对 forbidden 命令直接拒绝(不经审批层),防止绕过工具定义的路径;dangerous 不在此层拦截,保证 `test` 工具的 cmd.exe 嵌套回路不受影响。
- 审批体验:审批请求 summary 现在附带 argv 预览(120 字符截断);事件展示契约 `argHint` 修复为读取 `call.params`(此前读 `call.args`,tool:call 事件 argv 预览始终为空),`ARG_KEYS` 增加 `argv`。
- 版本同步为 `1.3.1`(`package.json` / `package-lock.json` / CLI-TUI banner);全量回归(991 项)与语法检查通过。
- 本版范围说明:对应设计中另两项(语义上下文降级可观测化 #8、GUI 休眠渲染层删除 #9.6)在 `feat/v1.3.0` 分支上继续开发,作为后续版本发布。

---

## v1.2.0 — 2026-07-19 · 工具安全护栏与仓库卫生

- `grep` 工具加超时闸:每文件(默认 2s)+ 总预算(默认 10s)协作式检查,病态正则不再拖死进程;超时不抛错,返回已得匹配并以 metadata(`timed_out` / `timed_out_scope` / `files_skipped_timeout` / `files_searched`)标注,非法 pattern 行为不变。
- `shell` 子进程环境改为**白名单继承**:仅透传 PATH、Windows 系统变量、用户/临时目录与区域设置;`DEEPSEEK_*`、`*_API_KEY` / `*_TOKEN` / `*_SECRET`、代理(`HTTP(S)_PROXY` / `NO_PROXY` / `ALL_PROXY`)与 `NODE_OPTIONS` 默认不可见。`git` 工具子进程走同一 `runProcess`,同样受白名单约束(`GIT_*` 被剥离;只读 git 操作不受影响)。
- 模型 id 可配置:config 顶层 `models.{act,think,fim}` 整体切换路由 CHANNELS 的模型,缺省与现网一致(`deepseek-v4-flash` / `deepseek-v4-pro`);gateway 与 FIM 路径同步透传,`explicitModel` 仍最高优先。
- 仓库卫生:`test/` 并入 `tests/`(npm test 单 glob);删除 `src/index.js` 无引用的 `createPausedRecoveryFacade`(净 -101 行);根目录原型 `DeepSeekCodeIDE.jsx` 与 `preview-deepseek-code` 轻量源码迁入 `docs/prototypes/`(node_modules 与日志不随迁),`.gitignore` 清 stale 行;51 份历史 plan 头部标注「完成状态以 CHANGELOG 为准」,roadmap 补 pivot 注记。
- 版本同步为 `1.2.0`(`package.json` / `package-lock.json` / CLI-TUI banner);全量回归通过、语法检查通过。
- 本版明确未做(仍挂账):#8 语义降级可观测、#9.3 明文变更记录、#9.6 UMD 副本、#10 `agent-runtime` 重构、shell 命令白名单。

---

## v1.1.0 — 2026-07-15 · 可靠性、安全与中文体验修复

- 中文请求不再全落 `general`:classifier 新增中英共享词表(edit / diagnostic / query / 全角问号),复杂度路由共用同一词表来源。
- GUI 删除分叉的 kernel-options 装配逻辑,动态复用 CLI/TUI 的共享实现;`orchestration` / `context.semantic` 配置与 override 语义三端一致。
- TUI busy 态 Esc 与 CLI SIGINT 可中断当前回合;中断收口为可读状态,不退出整个会话,审批续跑链同样受保护。
- `web_fetch` SSRF 加固:校验全部 DNS A 记录、补齐 CGNAT/0/8/benchmark/文档/组播等保留网段,默认网络路径固定到已验证 IP 直连(保留原 hostname 作 Host/SNI),消除校验后再次解析的 DNS rebinding/TOCTOU;网络层按 32KB 上限截断缓冲,重定向/非 2xx 丢弃 body。
- 脱敏扩面:确定性覆盖 AWS/GitHub/sk- token、私钥块及常见 token/secret/password 赋值;不启用易误伤源码的通用高熵猜测。
- 版本同步为 `1.1.0`(`package.json` / `package-lock.json` / CLI-TUI banner);受影响测试与全量回归通过。

---

## v1.0.0 — 2026-07-13 · 首个正式版本

Inkstone 的首个正式发布,**整合此前全部内部迭代**(V1 原型 → V2 干净运行时 → V3 三支柱)为一个统一版本。面向 DeepSeek 的**本地 AI 编程 Agent**:在你的项目目录里读代码、改代码、跑测试,并把每一步模型调用、工具执行、文件改动与审批记录成可回放、可分支、可回退的会话时间线。**CLI · TUI · 桌面 GUI 三端共用同一内核**,核心运行时零依赖(仅可选 WASM tree-sitter),Node ≥ 20 + 一个 API Key 即可运行。

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
