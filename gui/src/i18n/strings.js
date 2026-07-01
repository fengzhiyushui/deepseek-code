// Bilingual UI strings (zh default, en switchable). Pure — node:test-able.
const STRINGS = {
  zh: {
    "menu.file": "文件", "menu.edit": "编辑", "menu.selection": "选择", "menu.view": "查看",
    "menu.go": "转到", "menu.run": "运行", "menu.agent": "智能体", "menu.help": "帮助",
    "explorer": "资源管理器", "branches": "分支", "checkpoints": "检查点", "files": "文件",
    "noBranches": "暂无分支", "noCheckpoints": "暂无检查点",
    "panel.problems": "问题", "panel.output": "输出", "panel.debug": "调试控制台", "panel.terminal": "终端",
    "agent": "DeepSeek 智能体", "agent.plan": "计划", "agent.steps": "步",
    "agent.editing": "编辑", "agent.runTests": "运行测试", "agent.passed": "通过",
    "agent.ask": "问 DeepSeek Code 关于这个项目的任何问题。",
    "composer.placeholder": "给 DeepSeek Code 发消息…(Ctrl/⌘+Enter 发送)",
    "composer.send": "发送", "composer.interrupt": "中断", "composer.mode": "智能体 · 受控",
    "approval.required": "需要审批", "approval.approve": "批准", "approval.deny": "拒绝",
    "status.passing": "个测试通过", "status.spaces": "空格", "status.problems": "问题",
    "placeholder.badge": "示例 · 占位", "placeholder.files": "示例文件树(未接入)",
    "placeholder.editor": "示例编辑器(静态预览,Monaco 待接)", "placeholder.terminal": "示例终端(xterm 待接)",
    "rail.explorer": "资源管理器", "rail.search": "搜索", "rail.scm": "源代码管理",
    "rail.run": "运行和调试", "rail.ext": "扩展", "rail.agent": "DeepSeek 智能体", "rail.settings": "设置",
    "toggle.theme": "切换主题", "toggle.lang": "切换语言 / Switch language", "offline": "离线(无内核桥接)"
  },
  en: {
    "menu.file": "File", "menu.edit": "Edit", "menu.selection": "Selection", "menu.view": "View",
    "menu.go": "Go", "menu.run": "Run", "menu.agent": "Agent", "menu.help": "Help",
    "explorer": "Explorer", "branches": "Branches", "checkpoints": "Checkpoints", "files": "Files",
    "noBranches": "No branches", "noCheckpoints": "No checkpoints",
    "panel.problems": "Problems", "panel.output": "Output", "panel.debug": "Debug Console", "panel.terminal": "Terminal",
    "agent": "DeepSeek Agent", "agent.plan": "Plan", "agent.steps": "steps",
    "agent.editing": "Edit", "agent.runTests": "Run tests", "agent.passed": "passed",
    "agent.ask": "Ask DeepSeek Code anything about this project.",
    "composer.placeholder": "Message DeepSeek Code…  (Ctrl/⌘+Enter to send)",
    "composer.send": "Send", "composer.interrupt": "Interrupt", "composer.mode": "Agent · gated",
    "approval.required": "Approval required", "approval.approve": "Approve", "approval.deny": "Deny",
    "status.passing": "passing", "status.spaces": "Spaces", "status.problems": "problems",
    "placeholder.badge": "Sample · Placeholder", "placeholder.files": "Sample file tree (not wired)",
    "placeholder.editor": "Sample editor (static preview, Monaco later)", "placeholder.terminal": "Sample terminal (xterm later)",
    "rail.explorer": "Explorer", "rail.search": "Search", "rail.scm": "Source Control",
    "rail.run": "Run and Debug", "rail.ext": "Extensions", "rail.agent": "DeepSeek Agent", "rail.settings": "Settings",
    "toggle.theme": "Toggle theme", "toggle.lang": "Switch language / 切换语言", "offline": "offline (no kernel bridge)"
  }
};

export function translate(lang, key) {
  const dict = STRINGS[lang] || STRINGS.zh;
  return dict[key] ?? STRINGS.zh[key] ?? key;
}

export function makeT(lang) {
  return (key) => translate(lang, key);
}

export const LANGUAGES = ["zh", "en"];
