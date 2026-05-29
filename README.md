# deepseek-code

一个从零开始的 DeepSeek 专属本地编程助手。

当前版本是最小可用版：它能扫描项目、搜索代码、向 DeepSeek 提问、让模型生成补丁，并在你确认后应用修改。

## 快速开始

```bash
node bin/deepseek-code.js config init --api-key sk-xxx
node bin/deepseek-code.js tui
node bin/deepseek-code.js scan
node bin/deepseek-code.js search "TODO"
node bin/deepseek-code.js ask "解释这个项目的结构"
node bin/deepseek-code.js chat
node bin/deepseek-code.js edit "修复这个函数的边界条件" --file src/example.js
node bin/deepseek-code.js changes list
```

也可以用环境变量：

```bash
set DEEPSEEK_API_KEY=sk-xxx
set DEEPSEEK_MODEL=deepseek-v4-flash
set DEEPSEEK_BASE_URL=https://api.deepseek.com
set DEEPSEEK_REASONING_EFFORT=high
```

PowerShell：

```powershell
$env:DEEPSEEK_API_KEY="sk-xxx"
```

## 命令

```text
deepseek-code tui
deepseek-code ask "问题"
deepseek-code chat [问题] [--reset]
deepseek-code edit "修改需求" --file <path> [--dry-run] [--yes]
deepseek-code scan
deepseek-code search "关键词"
deepseek-code test [command...]
deepseek-code diff
deepseek-code config init --api-key <key>
deepseek-code config show
deepseek-code config test
deepseek-code changes list
deepseek-code changes show latest
deepseek-code rollback latest
deepseek-code resume
```

## TUI 界面

```bash
node bin/deepseek-code.js tui
```

命令统一使用英文，TUI 界面选项使用中文。当前支持方向键选择：

- 向 DeepSeek 提问：基于项目上下文提问。
- 连续对话：保留上下文进行多轮交流。
- 生成补丁修改：输入修改需求和文件列表，生成补丁，确认后应用。
- 搜索项目代码：搜索代码。
- 扫描项目上下文：查看项目索引。
- 运行测试：运行 `node --test`。
- 查看 Git 差异：查看当前 Git diff。
- 查看修改记录：查看最近补丁详情。
- 回退最近修改：恢复最近一次已记录的修改。
- 配置 API 密钥：写入 DeepSeek API 密钥、模型和接口地址。
- 测试 API 连接：验证当前 DeepSeek 配置是否可用。

按 `q` 退出，按方向键移动，按回车执行。

## DeepSeek 调用配置

项目按 DeepSeek 官方 OpenAI 兼容接口调用：

- 默认接口地址：`https://api.deepseek.com`
- 聊天接口：`/chat/completions`
- 认证方式：`Authorization: Bearer <api-key>`
- 默认模型：`deepseek-v4-flash`
- 可选模型：`deepseek-v4-pro`
- 默认推理强度：`high`

CLI 配置示例：

```bash
node bin/deepseek-code.js config init --api-key sk-xxx --model deepseek-v4-flash --reasoning-effort high
node bin/deepseek-code.js config init --api-key sk-xxx --model deepseek-v4-pro --reasoning-effort max
node bin/deepseek-code.js config test
```

如果需要启用官方 `thinking` 参数：

```bash
node bin/deepseek-code.js config init --api-key sk-xxx --thinking
```

## 设计边界

- 默认不会直接改文件，`edit` 会展示补丁并等待确认。
- 每次成功应用补丁后会写入 `.deepseek-code/changes/<id>.json`，用于查看详情和回退。
- 连续对话历史保存在 `.deepseek-code/chat.json`，可用 `chat --reset` 重新开始。
- 文件路径必须在当前项目根目录内。
- `.git`、`node_modules`、`dist`、`build`、`.deepseek-code` 等目录会被项目扫描忽略。
- 模型输出必须是 unified diff；如果上下文不够，建议加 `--file` 指定相关文件。

## 下一步优化方案

1. Agent Loop：让模型自动决定读取文件、搜索、生成补丁、运行测试，并根据测试错误继续修复。
2. 权限系统：为 shell 命令、文件写入、依赖安装、Git 操作建立审批策略和白名单。
3. 上下文选择：基于搜索结果、依赖图、最近修改记录动态挑选文件，而不是只靠项目扫描。
4. 回退增强：支持按文件回退、回退前 diff 预览、回退后自动运行测试。
5. 修改审查：新增 `review` 命令，对当前 git diff 或某个 change id 做风险检查。
6. TUI 升级：增加左右分栏、底部输入框、任务状态、流式输出区域和快捷键。
7. 测试集成：自动识别 npm/pytest/cargo/go test，并把失败摘要喂回模型继续处理。
8. 配置分层：区分全局配置和项目配置，支持模型、温度、thinking、权限策略按项目覆盖。
