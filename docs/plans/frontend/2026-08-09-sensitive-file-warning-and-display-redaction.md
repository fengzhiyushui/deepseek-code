# 敏感文件风险提醒 + 展示层脱敏(#9.3 前端片)实施方案

> 完成状态以 [CHANGELOG](../../CHANGELOG.md) 为准。
> **状态:v1.7.0 已发布(2026-08-09),本方案全部完成。**
> **目标版本:v1.7.0**(minor —— 三端各新增一类展示能力 + 一档配置,属「一次前端对齐」,不重构核心)。分支 `feat/v1.7`。

**来源:** [agent 审计补救计划](../../specs/backend/2026-07-12-agent-findings-remediation.md) #9.3 的剩余部分。后端卫生(大小上限 / 回滚守卫 / 保留期 / 目录限权)已在 **v1.6.2** 完成;本片做需要三端前端配合的两件事。

**技术栈:** Node ≥20 原生 `node:test`;CLI(`src/apps/cli/`)、TUI(`src/apps/tui/`,手写 ANSI)、GUI(Electron + React,`gui/src/`)。

---

## 全局约束

- **kernel 公开契约不变**:`send` / `approve` / `interrupt` 签名、事件发布顺序、错误语义不得改变。v1.6.3 的 7 条刻画测试是护栏,必须原样全绿。
- **存储内容一个字节不改**:回滚依赖 `before`/`after` 原文,展示层脱敏**只作用于渲染路径**,落盘保持原文。
- **测试基线只增不减**:起点 1035 项全绿。收尾须 `npm test` + `npm run check` + `npm run build:renderer` 三绿。
- 提交信息不带 `Co-Authored-By`。

---

# 第一部分:敏感文件独立风险提醒

## 要解决的问题

agent 改 `.env` / `*.pem` / `*.key` 等文件时,该文件的**完整原文**会被抄进 `.deepseek-code/changes/<id>.json`(回滚必需,不可脱敏 —— 见 #9.3 硬约束)。用户对此**毫无感知**。

## 设计立场(维护者 2026-08-09 定)

这不是「替用户挡住」或「替用户放行」的事,而是**用户自己该知情、自己该拍板**的事。

### 两条硬要求

1. **独立于所有权限档位之外。** 现有权限矩阵管的是「agent 能不能做这个动作」;本提醒告知的是「这个动作会在磁盘留下一份你看不见的密钥副本」—— 属**副作用告知**,不是动作授权。若混进权限档位,`auto` / `full-auto` 会一键放行,恰好绕过最该提醒的场景。
2. **红色显著标注**,三端各自实现,**不复用**普通审批卡片的样式。

**允许 → 继续(记录照常落盘,受 v1.6.2 卫生措施约束);不允许 → 不改这个文件。**

## 判定来源(已现成,勿新建清单)

```js
// src/context/workspace-indexer.js:85
export function contextSkipReason(inputPath)   // → "secret-file" | "credential-file" | ... | null
```
覆盖 `.env*` / `*.pem` / `*.key` / `*.p12` / `*.pfx` / `.npmrc` / 含 `credentials|token|apikey|auth` 的配置文件。

## ⚠ 开工前需拍板的两个细节

### ① 无人值守(`full-auto`)怎么办? — **已定:一律提问**

若提醒在 `full-auto` 下也一律阻塞等待,无人值守的长任务会卡死。

| 选项 | 后果 |
|------|------|
| (a) 一律阻塞 | 最安全,但无人值守场景会挂死 |
| **(b) `full-auto` 下不阻塞,直接拒绝** | ~~建议~~ **已否决** —— 前提有误:权限矩阵里 `full-auto` 的 `read_secret` / `execute_dangerous` 本就是 `ask`,它从来不是「无人值守免打扰」档,故一律提问反而与既有立场一致 |

### ② 记不记住选择?

若走审批缓存,就等于把「独立于权限之外」又拉回权限体系。**建议每次都提醒,不缓存** —— 这类告知的价值就在于每次都让人看见。

## 实现路径

提醒必须在**编辑真正发生之前**触发,且不能借道权限引擎。候选接入点:`editService.apply` 的预检阶段(`assertDiffPathsSafe` 之后、`store.capture` 之前),经一个**独立于 `permission-engine` 的回调**向上层要答复。

- 新增:`src/edits/sensitive-notice.js` —— 纯判定 + 提示载荷组装(`{ paths, reason, recordPath }`),不含 IO
- 修改:`src/edits/edit-service.js` —— `createEditService({ onSensitiveNotice })`,预检命中时 `await onSensitiveNotice(payload)`;返回 `false` → 抛 `SENSITIVE_EDIT_DECLINED`,编辑不发生
- 修改:`src/index.js` —— 把 kernel 层的 notice 回调透传到 editService(**不经权限引擎**)
- 三端各自实现回调 UI(见下)

## 任务

### 任务 1:纯判定层 + editService 接入

**文件**
- 创建:`src/edits/sensitive-notice.js`
- 修改:`src/edits/edit-service.js`
- 测试:`tests/unit/edits/sensitive-notice.test.js`

**接口**
- 产出:`buildSensitiveNotice(paths) → { paths: [{path, reason}], hasSensitive: boolean } | null`
- 产出:`createEditService({ onSensitiveNotice })` —— `onSensitiveNotice(payload) → Promise<boolean>`;**未注入时行为逐字节不变**(不提醒、不拦)

**步骤**
- [x] 1. 失败测试:`buildSensitiveNotice([".env", "src/a.js"])` 只标 `.env`,`reason === "secret-file"`
- [x] 2. 跑到失败 → 实现 → 跑绿
- [x] 3. 失败测试:注入 `onSensitiveNotice` 返回 `false` 时 `apply` 抛 `SENSITIVE_EDIT_DECLINED`,且**工作区文件未被改动、无 change 记录落盘**
- [x] 4. 失败测试:返回 `true` 时正常应用并落记录
- [x] 5. 失败测试:**未注入回调时行为与今天逐字节一致**(不拦、不提醒)
- [x] 6. 跑到失败 → 实现 → 跑绿 + 全量回归
- [x] 7. 提交

### 任务 2:CLI 红色提醒

**文件**:`src/apps/cli/render-events.js`、`src/apps/cli/kernel-runner.js`;测试 `tests/unit/apps/cli-sensitive-notice.test.js`

- [x] 1. 失败测试:提醒渲染为红色块,含文件路径、原因、「记录会存完整原文」的说明,且**视觉上区别于普通审批卡片**
- [x] 2. 失败测试:`full-auto` 档按拍板结论(建议 (b))不阻塞、拒绝并上报
- [x] 3. 跑到失败 → 实现 → 跑绿 → 提交

### 任务 3:TUI 红色提醒

**文件**:`src/apps/tui/event-cards.js`、`src/apps/tui/tui-state.js`、`src/apps/tui/tui-app.js`、`src/apps/tui/tui-i18n.js`(中英各一条);测试 `tests/unit/apps/tui/sensitive-notice.test.js`

- [x] 1. 失败测试:reducer 收到 notice 进入独立态(**不复用** `approval` 态),y/n 行内答复
- [x] 2. 失败测试:渲染走红色 ANSI,CJK 宽度计算正确
- [x] 3. 失败测试:i18n key 集中英对齐
- [x] 4. 跑到失败 → 实现 → 跑绿 → 提交

### 任务 4:GUI 红色提醒

**文件**:`gui/src/components/v4/`(新组件)、`gui/src/state/workbench-state.js`、`gui/src/i18n/strings.js`、`gui/preload.js` + `gui/main.js`(新 IPC channel,**须登记进 `IPC_CHANNELS` 白名单**否则启动即抛错)、`gui/kernel-host.js`

- [x] 1. 失败测试:reducer 的 notice 态与 `approval` 态**互不干扰**
- [x] 2. 失败测试:`IPC_CHANNELS` 已登记新 channel
- [x] 3. 跑到失败 → 实现 → 跑绿
- [x] 4. 红色样式走 `tokens.css` 既有 danger 色,不新造色值;`vite build` + 门控 Electron smoke 截图留档
- [x] 5. 提交

---

# 第二部分:展示层脱敏

## 要解决的问题

CLI `changes` / GUI `ChangeDiffView` 显示变更详情时,**密钥是原样打在屏幕上的**。这是唯一能让密钥**离开本地磁盘边界**的路径 —— 截图发同事、贴终端输出到 issue,密钥就跟着跑出去了。

> 注:`.deepseek-code/config.json` 本身已明文存 API Key,「本地磁盘明文」是项目既有的有意取舍;本片针对的是**越界**路径,不是磁盘存储。

## 硬约束

**存储保持原文供回滚**,脱敏只作用于渲染。`src/security/redactor.js` 已有实现,直接复用。

## 任务 5:三端展示脱敏

**文件**
- 修改:`gui/kernel-host.js` 的 `changes:describe` 桥 —— 回渲染层前过 `redactor`
- 修改:`src/apps/cli/render-events.js` / `src/cli.js` 的 `changes` 输出
- 修改:`src/apps/tui/event-cards.js` 的 diff 卡片
- 测试:`tests/unit/gui/kernel-host-changes-redaction.test.js`、`tests/unit/apps/cli-changes-redaction.test.js`

**步骤**
- [x] 1. 失败测试:`describeChange` 桥返回的 `before`/`after` 中 `sk-` 开头 token 被掩码,**而磁盘记录原文不变**(同时断言两侧)
- [x] 2. 失败测试:CLI `changes` 输出不含明文密钥
- [x] 3. 失败测试:回滚仍能用原文成功复原(**证明脱敏没污染存储**)
- [x] 4. 跑到失败 → 实现 → 跑绿 + 全量回归
- [x] 5. 提交

---

## 收尾

- [x] 补救 spec [2026-07-12-agent-findings-remediation.md](../../specs/backend/2026-07-12-agent-findings-remediation.md) 头部状态行:#9.3 **完全闭环**
- [x] `project-overview` §4/§15/§16 补三端提醒与脱敏说明
- [x] `docs/README.md` 当前版本 → v1.7.0
- [x] CHANGELOG v1.7.0 小节;版本同步四处;合入 main 并打 tag
