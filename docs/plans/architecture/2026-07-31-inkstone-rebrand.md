# Inkstone 改名实施方案(DeepSeek Code → Inkstone)

- 日期:2026-07-31
- 状态:**已实施并合入 main(2026-07-31)**
- 目标:规避与 DeepSeek 官方品牌混淆的纠纷风险;项目将发布到 GitHub 公开面

---

## 1. 背景与目标

项目现名 **DeepSeek Code**(包名 `deepseek-code`),与 DeepSeek 官方品牌高度相似,存在商标/品牌混淆纠纷风险;项目将发布到 GitHub 公开面,公开暴露面的品牌沿用会放大该风险。本次改名将产品品牌替换为 **Inkstone(砚)**,同时**保留与 DeepSeek API 集成的全部功能契约**。

**非目标**:不改 API 功能契约(端点/模型 id/错误码/配置键/env)、不改 kernel 行为、不引入版本号 bump、不动历史文件名。

## 2. 目标命名

| 形态 | 旧 | 新 |
|---|---|---|
| 显示名 | DeepSeek Code | **Inkstone**(副文案:「面向 DeepSeek 的本地 AI 编程 Agent」) |
| kebab(package/repo/bin/命令) | deepseek-code | **inkstone** |
| 命令 | `deepseek-code` | `inkstone`(保留短别名 `dsc`,删除旧命令) |
| 大写 | DEEPSEEK-CODE | INKSTONE |
| GUI 包名 | deepseek-code-gui | inkstone-gui |

## 3. 判断矩阵(用户授权逐项判断)

| 类别 | 处置 | 代表项 |
|---|---|---|
| **必改** | 品牌暴露面(人类/模型/服务端可见的产品身份) | BRAND、窗口/页面标题、GUI 文案、TUI banner、system prompt 产品自称、User-Agent、README/docs 品牌、mockup/设计稿标题、package/bin/gui 包名、conda 名、tests golden |
| **保留** | 内部/契约,无纠纷收益,改了断用户环境 | `.deepseek-code` 存储目录、`DEEPSEEK_*` env、错误码 `DEEPSEEK_API_ERROR`、`window.deepseek` 桥、`gui-api-profiles.json`(代码注释标记历史遗留)、GUI 内部开关 `DEEPSEEK_CODE_GUI_*`、`src/deepseek/` 模块与全部 `DeepSeek*` 导出符号(语义=DeepSeek API 集成,非产品品牌)、`options.deepseek` 配置键、api-profiles 默认 profile 名 |
| **不改** | 上游契约 + 模型 id + 历史文件名 | `api.deepseek.com`、`deepseek-v4-flash`/`deepseek-v4-pro`/`deepseek-chat`/`deepseek-coder`、5 处文件名含 `deepseek-code` 的历史文档(避免断链)、`.claude/settings.json` 仓库路径 |

## 4. 替换映射(4 形态分别处理)

- **U** `DeepSeek Code` → `Inkstone`(显示品牌,全局安全)
- **k** `deepseek-code` → `inkstone`(**必须排除前导点 `.deepseek-code`** —— naive 全局替换会把它变成 `.inkstone`,直接断全部存储契约)
- **K** `DEEPSEEK-CODE` → `INKSTONE`(GUI 侧栏项目标签等)
- **P** `DeepSeek-Code` → `inkstone`(User-Agent 单点)

### 源码显示品牌(必改)
`src/theme.js:1` BRAND、`:19` 副文案 · `src/cli.js:61` 未知命令提示、`:337-353` help 命令名 · `src/provider.js:126` 认证提示里的命令名 · `src/apps/tui/tui-i18n.js:11,74` banner · `src/deepseek/prompt-assembler.js:4`、`src/core/verification/repair-prompt.js:34` system prompt 产品自称(保留 `optimized for DeepSeek models`,用户已放行)· `src/tools/builtin/web-fetch.js:27` User-Agent · `bin/deepseek-code.js` → `git mv` 为 `bin/inkstone.js`,`:7` 错误前缀。

### GUI(必改)
`gui/main.js:83` 窗口标题 · `gui/index.html:6` `<title>` · `gui/src/App.jsx:80` 项目标签 · `Explorer.jsx:106` · `Settings/Settings.jsx:78` About · `i18n/strings.js` 产品自称串(保留「DeepSeek 智能体」等模型方事实表述)· `styles/theme.css:1` 注释 · `gui/package.json:2,4` + `gui/package-lock.json`。`gui/renderer-dist/**` 为 gitignore 构建产物,改源码后 `build:renderer` 重建。

### 结构标识(必改)
`package.json`(name、bin、check 脚本)+ `package-lock.json` · `environment.yml` · 测试 golden(e2e smoke)。

### 文档(必改)
根 `README.md`/`README.en.md`(标题、clone 目录名、bin 路径、命令名、品牌叙述段;商标声明保留)· `docs/README.md` · `docs/CHANGELOG.md` · `docs/project-overview.md` 标题 · 根 `docs/prototypes/DeepSeekCodeIDE.jsx` 可见串(`:514` 旧模型名、`:1263` 组件名+文件名保留,断链风险)。(v1.4.0 设计稿/spec/plan 的品牌串改动随 v1.4.1 留在 `feat/v1.4.0`,不在 main 范围。)

### 本地(gitignore,同步但不提交)
`.claude/settings.local.json`、`.claude/skills/verify/SKILL.md` 的 bin 命令引用。

## 5. 执行阶段

- **P0 基线**:建 `feat/inkstone-rebrand` + 本方案文档落库 + docs/README 索引。(v1.4.1 文档补丁 `090a383` 留在 `feat/v1.4.0`,未合入 main。)
- **P1 结构+测试(Commit B)**:`git mv bin`、package.json+lock、gui 包名+lock、environment.yml、e2e smoke、`.claude` 本地同步、web-fetch UA。
- **P2 CLI/TUI 显示串 + 提示词(Commit C)**:theme.js、cli.js、tui-i18n.js、provider.js:126、prompt-assembler.js、repair-prompt.js。
- **P4 GUI(Commit D)**:GUI 显示串 + `build:renderer`。
- **P5 文档+原型(Commit E)**:README×2、docs、设计稿标题。
- **P6 收口**:收口 grep 仅剩允许清单;`npm test` 全绿;`npm run check`;`git status` 干净。

## 6. 验证

1. `npm test` 全绿 + `npm run check` + e2e smoke ×4
2. `node ./bin/inkstone.js help / ask / tui` 正常;`dsc help` 别名可用;旧 `deepseek-code` 命令消失
3. GUI:窗口标题 / About / 侧栏项目标签显示 Inkstone;`gui-smoke` 过
4. 收口 grep 命中全在允许清单内
5. `.deepseek-code` 目录与 `DEEPSEEK_*` env 行为不变(既有项目数据可读)

## 7. 收口 grep(仅剩允许清单)

`grep -rniE "deepseek" src/ gui/ bin/ README*.md docs/ tests/`(排除 node_modules),允许命中 = `deepseek.com` · `deepseek-v4-*` · `deepseek-chat` · `deepseek-coder` · `DEEPSEEK_API_KEY/_BASE_URL/_MODEL/_REASONING_EFFORT/_TOOL_TIMEOUT_MS/_MODEL_TIMEOUT_MS` · `DEEPSEEK_API_ERROR` · `DEEPSEEK_CODE_GUI_*` · `.deepseek-code` · `src/deepseek` 模块与 `DeepSeek*` 符号 · 保留文件名 · 历史 spec/plan。其余 = 违规。

## 8. 风险

| 风险 | 对策 |
|---|---|
| `.deepseek-code` 前缀被 naive 全局替换(高) | Batch k 负向后瞻 + 逐文件复核 + 收口 grep 兜底 |
| 保留文件名/符号误改断链(高) | 明确不改清单;`src/deepseek`、`DeepSeekCodeIDE.jsx:1263`、`preview-deepseek-code/` 绝不碰 |
| package-lock 与 package.json 失同步 | P1 同批改 lock;`npm ci` 冒烟 |
| e2e golden 红 | golden 与 bin 改名同 commit |
| `renderer-dist` 旧标题 | 改源码后 `build:renderer` 重建 |
| system prompt = API 内容 | 已获用户放行;仅产品自称改,功能契约零变 |
