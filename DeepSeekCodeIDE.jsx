import "@douyinfe/semi-ui/react19-adapter";
import React from "react";
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ConfigProvider,
  Input,
  Layout,
  List,
  Nav,
  Progress,
  Space,
  TabPane,
  Tabs,
  Tag,
  TextArea,
  Timeline,
  Tooltip,
  Tree,
  Typography,
} from "@douyinfe/semi-ui";
import "@douyinfe/semi-ui/dist/css/semi.min.css";
import {
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Code2,
  Columns2,
  Command,
  FileCode2,
  FileJson2,
  FileText,
  Files,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  History,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  PauseCircle,
  Play,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  TestTube2,
  Wrench,
  X,
} from "lucide-react";

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

const railItems = [
  { itemKey: "files", text: "Files", icon: <Files size={18} /> },
  { itemKey: "agent", text: "Agent", icon: <Bot size={18} /> },
  { itemKey: "search", text: "Search", icon: <Search size={18} /> },
  { itemKey: "git", text: "Source", icon: <GitBranch size={18} /> },
  { itemKey: "runs", text: "Runs", icon: <Play size={18} /> },
  { itemKey: "history", text: "History", icon: <History size={18} /> },
];

const fileTree = [
  {
    label: "src",
    key: "src",
    icon: <FolderGit2 size={15} />,
    children: [
      {
        label: "tools",
        key: "src/tools",
        icon: <FolderGit2 size={15} />,
        children: [
          { label: "file-search.js", key: "src/tools/file-search.js", icon: <FileCode2 size={15} /> },
          { label: "registry.js", key: "src/tools/registry.js", icon: <FileCode2 size={15} /> },
          { label: "schema.js", key: "src/tools/schema.js", icon: <FileCode2 size={15} /> },
        ],
      },
      {
        label: "core",
        key: "src/core",
        icon: <FolderGit2 size={15} />,
        children: [
          { label: "agent-runtime.js", key: "src/core/agent-runtime.js", icon: <FileCode2 size={15} /> },
          { label: "executor-loop.js", key: "src/core/executor-loop.js", icon: <FileCode2 size={15} /> },
        ],
      },
    ],
  },
  {
    label: "tests",
    key: "tests",
    icon: <FolderGit2 size={15} />,
    children: [
      { label: "file-search.test.js", key: "tests/file-search.test.js", icon: <FileCode2 size={15} /> },
      { label: "registry.test.js", key: "tests/registry.test.js", icon: <FileCode2 size={15} /> },
    ],
  },
  { label: "package.json", key: "package.json", icon: <FileJson2 size={15} /> },
  { label: "README.md", key: "README.md", icon: <FileText size={15} /> },
];

const sessions = [
  { title: "Implement file search tool", state: "running", changed: 3 },
  { title: "Approval resume hardening", state: "blocked", changed: 1 },
  { title: "Explain context cache", state: "done", changed: 0 },
];

const planSteps = [
  { label: "Map existing registry API", status: "done" },
  { label: "Create file search tool", status: "running" },
  { label: "Wire exports and schema", status: "queued" },
  { label: "Run focused tests", status: "queued" },
];

const toolCalls = [
  { name: "read", target: "src/tools/registry.js", status: "done" },
  { name: "grep", target: "createTool", status: "done" },
  { name: "edit", target: "src/tools/file-search.js", status: "running" },
  { name: "test", target: "tests/unit/tools", status: "queued" },
];

const chatMessages = [
  {
    role: "user",
    meta: "request",
    content: "Add a file search tool that supports regex, path filters, and short content preview.",
  },
  {
    role: "agent",
    meta: "editing src/tools/file-search.js",
    content: "I found the registry pattern. I am adding the tool as a small, schema-backed implementation and keeping path handling inside the existing workspace safety layer.",
  },
  {
    role: "agent",
    meta: "waiting for approval",
    content: "The next step is to run the focused test file. I need approval before executing the command so the run stays explicit and recoverable.",
  },
];

const codeLines = [
  [["kw", "import"], ["plain", " { glob } "], ["kw", "from"], ["str", " 'fast-glob'"], ["plain", ";"]],
  [["kw", "import"], ["plain", " { readFile } "], ["kw", "from"], ["str", " 'node:fs/promises'"], ["plain", ";"]],
  [["kw", "import"], ["plain", " { createTool } "], ["kw", "from"], ["str", " './registry.js'"], ["plain", ";"]],
  [],
  [["kw", "const"], ["plain", " schema = {"]],
  [["plain", "  query: { type: "], ["str", "'string'"], ["plain", ", minLength: "], ["num", "1"], ["plain", " }," ]],
  [["plain", "  regex: { type: "], ["str", "'boolean'"], ["plain", ", default: "], ["kw", "false"], ["plain", " }," ]],
  [["plain", "  preview: { type: "], ["str", "'boolean'"], ["plain", ", default: "], ["kw", "true"], ["plain", " }," ]],
  [["plain", "};"]],
  [],
  [["kw", "export"], ["plain", " "], ["kw", "const"], ["plain", " "], ["fn", "fileSearchTool"], ["plain", " = "], ["fn", "createTool"], ["plain", "({"]],
  [["plain", "  name: "], ["str", "'file_search'"], ["plain", ","]],
  [["plain", "  description: "], ["str", "'Search files and return ranked previews'"], ["plain", ","]],
  [["plain", "  schema,"]],
  [["plain", "  "], ["kw", "async"], ["plain", " "], ["fn", "run"], ["plain", "(input, context) {"]],
  [["plain", "    "], ["kw", "const"], ["plain", " pattern = input.regex ? input.query : "], ["fn", "escapeGlob"], ["plain", "(input.query);"]],
  [["plain", "    "], ["kw", "const"], ["plain", " files = "], ["kw", "await"], ["plain", " "], ["fn", "glob"], ["plain", "("], ["str", "'**/*'"], ["plain", ", { cwd: context.workspaceRoot });"]],
  [["plain", "    "], ["kw", "const"], ["plain", " matches = "], ["kw", "await"], ["plain", " "], ["fn", "collectMatches"], ["plain", "(files, pattern, context);"]],
  [["plain", "    "], ["kw", "return"], ["plain", " { matches };"]],
  [["plain", "  }"]],
  [["plain", "});"]],
  [],
  [["kw", "async"], ["plain", " "], ["kw", "function"], ["plain", " "], ["fn", "collectMatches"], ["plain", "(files, pattern, context) {"]],
  [["plain", "  "], ["kw", "return"], ["plain", " files."], ["fn", "slice"], ["plain", "("], ["num", "0"], ["plain", ", "], ["num", "20"], ["plain", ");"]],
  [["plain", "}"]],
];

const diffLines = [
  "+ export const fileSearchTool = createTool({",
  "+   name: 'file_search',",
  "+   schema,",
  "+   async run(input, context) {",
  "+     const files = await glob('**/*', { cwd: context.workspaceRoot });",
  "+     const matches = await collectMatches(files, input.query, context);",
  "+     return { matches };",
  "+   }",
  "+ });",
];

const timelineItems = [
  {
    time: "17:32",
    type: "ongoing",
    content: (
      <div>
        <Text strong>Editing file-search.js</Text>
        <Text type="tertiary" size="small" className="ide-block">
          Writing implementation and result shape.
        </Text>
      </div>
    ),
  },
  {
    time: "17:29",
    type: "success",
    content: (
      <div>
        <Text strong>Registry pattern found</Text>
        <Text type="tertiary" size="small" className="ide-block">
          Tool factory and schema conventions loaded.
        </Text>
      </div>
    ),
  },
];

const tone = {
  plain: "ide-code-plain",
  kw: "ide-code-keyword",
  fn: "ide-code-fn",
  str: "ide-code-string",
  num: "ide-code-number",
};

function StatusIcon({ status }) {
  if (status === "done") return <CheckCircle2 size={15} className="ide-ok" />;
  if (status === "running") return <Loader2 size={15} className="ide-spin" />;
  if (status === "blocked") return <AlertTriangle size={15} className="ide-warn" />;
  return <Circle size={15} className="ide-muted-icon" />;
}

function TopBar() {
  return (
    <Header className="ide-topbar">
      <div className="ide-brand">
        <div className="ide-logo">
          <Code2 size={20} />
        </div>
        <div>
          <Title heading={5} className="ide-title-reset">
            DeepSeek Code
          </Title>
          <Text type="tertiary" size="small">
            agent programming workspace
          </Text>
        </div>
      </div>
      <Input
        prefix={<Command size={15} />}
        suffix={<Text type="tertiary">Ctrl K</Text>}
        placeholder="Search files, symbols, commands, agent tasks"
        className="ide-command"
      />
      <Space spacing={8} className="ide-top-actions">
        <Tag color="blue" prefixIcon={<GitBranch size={13} />}>
          main
        </Tag>
        <Tag color="green" prefixIcon={<ShieldCheck size={13} />}>
          trusted
        </Tag>
        <Tooltip content="Notifications">
          <Button theme="borderless" icon={<Bell size={17} />} />
        </Tooltip>
        <Avatar color="blue" size="small">
          D
        </Avatar>
      </Space>
    </Header>
  );
}

function ActivityRail() {
  return (
    <Sider className="ide-rail">
      <Nav
        selectedKeys={["files"]}
        items={railItems}
        mode="vertical"
        footer={{
          collapseButton: false,
          children: (
            <Space vertical spacing={8} align="center">
              <Tooltip content="Settings" position="right">
                <Button theme="borderless" icon={<Settings size={18} />} />
              </Tooltip>
              <Badge dot type="success">
                <Avatar size="small" color="light-blue">
                  DS
                </Avatar>
              </Badge>
            </Space>
          ),
        }}
      />
    </Sider>
  );
}

function Sidebar() {
  return (
    <Sider className="ide-sidebar">
      <div className="ide-sidebar-head">
        <div>
          <Text type="tertiary" size="small">
            Workspace
          </Text>
          <div className="ide-project-title">
            <Text strong>deepseek-code</Text>
            <ChevronDown size={14} />
          </div>
        </div>
        <Button theme="borderless" icon={<MoreHorizontal size={16} />} />
      </div>

      <div className="ide-file-panel">
        <Input prefix={<Search size={14} />} placeholder="Filter files" size="small" />
        <Tree
          treeData={fileTree}
          defaultExpandedKeys={["src", "src/tools", "src/core", "tests"]}
          selectedKey="src/tools/file-search.js"
          blockNode
          showLine
          className="ide-file-tree"
          renderLabel={(label) => <Text ellipsis={{ showTooltip: true }}>{label}</Text>}
        />
      </div>

      <div className="ide-session-panel">
        <div className="ide-section-row">
          <Text strong>Agent Tasks</Text>
          <Badge count={3} type="primary" />
        </div>
        <List
          split={false}
          dataSource={sessions}
          renderItem={(session, index) => (
            <List.Item className={`ide-session-row ${index === 0 ? "is-active" : ""}`}>
              <StatusIcon status={session.state} />
              <div className="ide-session-copy">
                <Text strong ellipsis={{ showTooltip: true }}>
                  {session.title}
                </Text>
                <Text type="tertiary" size="small">
                  {session.changed} files changed
                </Text>
              </div>
            </List.Item>
          )}
        />
      </div>
    </Sider>
  );
}

function EditorTabs() {
  return (
    <Tabs
      type="card"
      activeKey="file-search"
      size="small"
      className="ide-editor-tabs"
      tabBarExtraContent={
        <Space spacing={4}>
          <Button theme="borderless" icon={<Columns2 size={15} />} />
          <Button theme="borderless" icon={<MoreHorizontal size={15} />} />
        </Space>
      }
    >
      <TabPane tab="file-search.js" itemKey="file-search" />
      <TabPane tab="registry.js" itemKey="registry" />
      <TabPane tab="file-search.test.js" itemKey="test" />
    </Tabs>
  );
}

function CodeEditor() {
  return (
    <div className="ide-code-surface">
      <div className="ide-breadcrumb">
        <Space spacing={6}>
          <Text type="tertiary">src</Text>
          <Text type="tertiary">/</Text>
          <Text type="tertiary">tools</Text>
          <Text type="tertiary">/</Text>
          <Text strong>file-search.js</Text>
        </Space>
        <Space spacing={6}>
          <Tag color="light-blue">JavaScript</Tag>
          <Tag color="green">agent edit</Tag>
        </Space>
      </div>
      <div className="ide-code-body">
        {codeLines.map((tokens, index) => (
          <div className="ide-code-line" key={index}>
            <span className="ide-line-number">{index + 1}</span>
            <code>
              {tokens.length === 0
                ? "\u00A0"
                : tokens.map(([kind, value], tokenIndex) => (
                    <span className={tone[kind]} key={`${index}-${tokenIndex}`}>
                      {value}
                    </span>
                  ))}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomPanel() {
  return (
    <div className="ide-bottom-panel">
      <Tabs type="line" activeKey="terminal" size="small" className="ide-bottom-tabs">
        <TabPane tab={<span className="ide-tab-label"><SquareTerminal size={14} />Terminal</span>} itemKey="terminal" />
        <TabPane tab={<span className="ide-tab-label"><GitPullRequest size={14} />Diff</span>} itemKey="diff" />
        <TabPane tab={<span className="ide-tab-label"><TestTube2 size={14} />Tests</span>} itemKey="tests" />
      </Tabs>
      <div className="ide-bottom-grid">
        <div className="ide-terminal">
          <p><span className="ide-terminal-accent">deepseek-code</span><span className="ide-terminal-muted"> on </span>main</p>
          <p><span className="ide-terminal-muted">$ </span>pnpm test --run file-search</p>
          <p className="ide-terminal-muted">&gt; vitest run tests/unit/tools/file-search.test.js</p>
          <p><span className="ide-run-pill">RUN</span><span className="ide-terminal-muted"> 8 tests queued</span></p>
        </div>
        <div className="ide-diff-mini">
          {diffLines.map((line, index) => (
            <div className="ide-diff-line" key={index}>
              <span>{index + 1}</span>
              <code>{line}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CodeWorkspace() {
  return (
    <Content className="ide-center">
      <EditorTabs />
      <CodeEditor />
      <BottomPanel />
    </Content>
  );
}

function PlanSummary() {
  return (
    <div className="ide-agent-block">
      <div className="ide-agent-block-head">
        <Space spacing={6}>
          <CheckCircle2 size={15} />
          <Text strong>Plan</Text>
        </Space>
        <Tag color="blue">Build</Tag>
      </div>
      <div className="ide-plan-list">
        {planSteps.map((step, index) => (
          <div className="ide-plan-row" key={step.label}>
            <span className={`ide-plan-index is-${step.status}`}>{index + 1}</span>
            <Text strong={step.status === "running"} ellipsis={{ showTooltip: true }}>
              {step.label}
            </Text>
            <StatusIcon status={step.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCalls() {
  return (
    <div className="ide-agent-block">
      <div className="ide-agent-block-head">
        <Space spacing={6}>
          <Wrench size={15} />
          <Text strong>Tool Calls</Text>
        </Space>
        <Tag color="light-blue">live</Tag>
      </div>
      <div className="ide-tool-list">
        {toolCalls.map((tool) => (
          <div className="ide-tool-row" key={`${tool.name}-${tool.target}`}>
            <StatusIcon status={tool.status} />
            <Text strong>{tool.name}</Text>
            <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>
              {tool.target}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatPanel() {
  return (
    <aside className="ide-agent-panel">
      <div className="ide-agent-head">
        <Space spacing={10}>
          <Avatar color="blue" size="small">
            <Bot size={15} />
          </Avatar>
          <div>
            <div className="ide-agent-title-line">
              <MessageSquare size={15} />
              <Text strong>Agent Chat</Text>
            </div>
            <Text type="tertiary" size="small" className="ide-block">
              deepseek-coder / editing
            </Text>
          </div>
        </Space>
        <Space spacing={4}>
          <Tooltip content="Stop generation">
            <Button theme="borderless" icon={<PauseCircle size={15} />} />
          </Tooltip>
          <Button theme="borderless" icon={<X size={15} />} />
        </Space>
      </div>

      <div className="ide-agent-status">
        <Tag color="green">context: src/tools</Tag>
        <Tag color="orange">approval required</Tag>
        <Tag color="light-blue">3 files in scope</Tag>
      </div>

      <div className="ide-agent-scroll">
        <div className="ide-chat-thread">
          {chatMessages.map((message, index) => (
            <div className={`ide-chat-message is-${message.role}`} key={`${message.role}-${index}`}>
              <Avatar color={message.role === "user" ? "grey" : "blue"} size="small">
                {message.role === "user" ? "U" : <Bot size={14} />}
              </Avatar>
              <div className="ide-chat-bubble">
                <div className="ide-chat-title">
                  <Text strong>{message.role === "user" ? "You" : "DeepSeek Code"}</Text>
                  <Tag color={message.role === "user" ? "grey" : "light-blue"}>{message.meta}</Tag>
                </div>
                <Text className="ide-block">{message.content}</Text>
              </div>
            </div>
          ))}
        </div>

        <Banner
          className="ide-approval"
          type="warning"
          closeIcon={null}
          icon={<AlertTriangle size={16} />}
          description={
            <div>
              <Text strong>Approval needed</Text>
              <Text type="secondary" size="small" className="ide-block">
                Run focused tests after edit.
              </Text>
              <Space spacing={6} className="ide-approval-actions">
                <Button size="small" theme="light">Deny</Button>
                <Button size="small" theme="solid" type="warning">Approve</Button>
              </Space>
            </div>
          }
        />

        <div className="ide-agent-runtime">
          <PlanSummary />
          <ToolCalls />
        </div>

        <div className="ide-agent-block">
          <div className="ide-agent-block-head">
            <Space spacing={6}>
              <History size={15} />
              <Text strong>Activity</Text>
            </Space>
          </div>
          <Timeline dataSource={timelineItems} mode="left" />
        </div>
      </div>

      <div className="ide-agent-composer">
        <div className="ide-composer-meta">
          <Tag color="blue">Edit mode</Tag>
          <Tag color="green">Auto context</Tag>
        </div>
        <TextArea placeholder="Ask Agent to edit, explain, test, or revert..." autosize={{ minRows: 3, maxRows: 4 }} />
        <div className="ide-composer-actions">
          <Space wrap spacing={6}>
            <Button size="small" theme="borderless" icon={<Paperclip size={15} />}>Attach</Button>
            <Button size="small" theme="light" icon={<Sparkles size={15} />}>@code</Button>
            <Button size="small" theme="light" icon={<Wrench size={15} />}>tools</Button>
          </Space>
          <Button theme="solid" type="primary" icon={<Send size={15} />} />
        </div>
      </div>
    </aside>
  );
}

function ScopedStyles() {
  return (
    <style>{`
      .ide-shell {
        --ide-bg: #f5f7fb;
        --ide-panel: #ffffff;
        --ide-soft: #f9fafc;
        --ide-border: #e5e8f0;
        --ide-text: #1f2430;
        --ide-blue: #155eef;
        --ide-green: #087443;
        --ide-orange: #b35309;
        height: 100vh;
        min-height: 760px;
        overflow: hidden;
        background: var(--ide-bg);
        color: var(--ide-text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .ide-title-reset {
        margin: 0;
        line-height: 20px;
      }

      .ide-block {
        display: block;
      }

      .ide-body {
        height: calc(100vh - 58px);
        min-height: 702px;
        display: grid;
        grid-template-columns: 58px 286px minmax(540px, 1fr) 420px;
        overflow: hidden;
      }

      .ide-topbar {
        height: 58px;
        display: grid;
        grid-template-columns: 280px minmax(360px, 1fr) 360px;
        gap: 18px;
        align-items: center;
        padding: 0 16px;
        border-bottom: 1px solid var(--ide-border);
        background: #fff;
      }

      .ide-brand,
      .ide-top-actions,
      .ide-project-title,
      .ide-section-row,
      .ide-tab-label,
      .ide-agent-head,
      .ide-agent-title-line,
      .ide-agent-status,
      .ide-agent-block-head,
      .ide-chat-message,
      .ide-chat-title,
      .ide-plan-row,
      .ide-tool-row,
      .ide-diff-line,
      .ide-composer-meta,
      .ide-composer-actions {
        display: flex;
        align-items: center;
      }

      .ide-brand {
        gap: 10px;
        min-width: 0;
      }

      .ide-logo {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 8px;
        color: #fff;
        background: var(--ide-blue);
        box-shadow: 0 8px 20px rgba(21, 94, 239, 0.2);
      }

      .ide-command {
        min-width: 0;
      }

      .ide-command .semi-input-suffix {
        white-space: nowrap;
      }

      .ide-top-actions {
        justify-content: flex-end;
        gap: 8px;
      }

      .ide-rail {
        width: 58px;
        min-width: 58px;
        border-right: 1px solid var(--ide-border);
        background: #eef2f8;
      }

      .ide-rail .semi-navigation,
      .ide-rail .semi-navigation-inner {
        width: 58px;
        background: transparent;
      }

      .ide-rail .semi-navigation-item {
        justify-content: center;
      }

      .ide-rail .semi-navigation-item-text {
        display: none;
      }

      .ide-sidebar {
        width: 286px;
        min-width: 286px;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--ide-border);
        background: #fff;
      }

      .ide-sidebar-head {
        height: 72px;
        display: flex;
        justify-content: space-between;
        padding: 14px;
        border-bottom: 1px solid var(--ide-border);
      }

      .ide-project-title {
        gap: 6px;
        margin-top: 4px;
      }

      .ide-file-panel {
        min-height: 0;
        flex: 1;
        overflow: auto;
        padding: 12px;
      }

      .ide-file-tree {
        margin-top: 10px;
      }

      .ide-file-tree .semi-tree-option {
        min-height: 28px;
        border-radius: 6px;
      }

      .ide-session-panel {
        flex: 0 0 auto;
        padding: 12px;
        border-top: 1px solid var(--ide-border);
        background: var(--ide-soft);
      }

      .ide-section-row {
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .ide-session-row {
        display: flex;
        gap: 8px;
        min-height: 42px;
        padding: 6px !important;
        border-radius: 7px;
      }

      .ide-session-row.is-active {
        background: #eff6ff;
      }

      .ide-session-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .ide-center {
        min-width: 0;
        display: flex;
        flex-direction: column;
        background: #fff;
      }

      .ide-editor-tabs {
        height: 42px;
        flex: 0 0 42px;
        border-bottom: 1px solid var(--ide-border);
        background: #f8f9fd;
      }

      .ide-editor-tabs .semi-tabs-bar {
        margin: 0;
      }

      .ide-code-surface {
        min-height: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        background: #fff;
      }

      .ide-breadcrumb {
        height: 36px;
        flex: 0 0 36px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        border-bottom: 1px solid var(--ide-border);
      }

      .ide-code-body {
        min-height: 0;
        flex: 1;
        overflow: auto;
        padding: 16px 0 24px;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        font-size: 12.5px;
        line-height: 24px;
      }

      .ide-code-line {
        display: grid;
        grid-template-columns: 58px minmax(760px, 1fr);
        min-height: 24px;
      }

      .ide-code-line:hover {
        background: #f7f9fc;
      }

      .ide-line-number {
        padding-right: 14px;
        text-align: right;
        color: #9ca3af;
        user-select: none;
      }

      .ide-code-line code {
        white-space: pre;
      }

      .ide-code-plain {
        color: #273142;
      }

      .ide-code-keyword {
        color: #7c3aed;
      }

      .ide-code-fn {
        color: var(--ide-blue);
      }

      .ide-code-string {
        color: #b35309;
      }

      .ide-code-number {
        color: #be123c;
      }

      .ide-bottom-panel {
        height: 220px;
        flex: 0 0 220px;
        border-top: 1px solid var(--ide-border);
        background: #0f172a;
      }

      .ide-bottom-tabs {
        height: 38px;
        background: #111827;
      }

      .ide-bottom-tabs .semi-tabs-bar {
        margin: 0;
        padding-left: 12px;
      }

      .ide-bottom-tabs .semi-tabs-tab {
        color: #cbd5e1;
      }

      .ide-tab-label {
        gap: 5px;
      }

      .ide-bottom-grid {
        height: 182px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 360px;
        overflow: hidden;
      }

      .ide-terminal {
        padding: 12px 16px;
        overflow: hidden;
        color: #dbeafe;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        line-height: 20px;
      }

      .ide-terminal p {
        margin: 0;
      }

      .ide-terminal-muted {
        color: #94a3b8;
      }

      .ide-terminal-accent {
        color: #7dd3fc;
        font-weight: 700;
      }

      .ide-run-pill {
        display: inline-flex;
        height: 18px;
        align-items: center;
        padding: 0 6px;
        margin-right: 6px;
        border-radius: 4px;
        color: #052e16;
        background: #86efac;
        font-weight: 700;
      }

      .ide-diff-mini {
        overflow: auto;
        padding: 10px 0;
        border-left: 1px solid rgba(148, 163, 184, 0.24);
        color: #86efac;
        font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
        font-size: 11px;
        line-height: 19px;
      }

      .ide-diff-line {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
      }

      .ide-diff-line span {
        padding-right: 10px;
        text-align: right;
        color: #4ade80;
        user-select: none;
      }

      .ide-diff-line code {
        overflow: hidden;
        white-space: pre;
        text-overflow: ellipsis;
      }

      .ide-agent-panel {
        width: 420px;
        min-width: 420px;
        height: 100%;
        min-height: 0;
        display: grid;
        grid-template-rows: 58px auto minmax(0, 1fr) auto;
        overflow: hidden;
        border-left: 1px solid var(--ide-border);
        background: #f8fafc;
      }

      .ide-agent-head {
        height: 58px;
        justify-content: space-between;
        padding: 0 14px;
        border-bottom: 1px solid var(--ide-border);
        background: #fff;
      }

      .ide-agent-title-line {
        gap: 6px;
      }

      .ide-agent-status {
        min-height: 42px;
        gap: 6px;
        flex-wrap: wrap;
        padding: 8px 12px;
        border-bottom: 1px solid var(--ide-border);
        background: #fff;
      }

      .ide-agent-scroll {
        min-height: 0;
        overflow: auto;
        padding: 12px;
      }

      .ide-chat-thread {
        display: grid;
        gap: 10px;
        margin-bottom: 12px;
      }

      .ide-chat-message {
        gap: 8px;
        align-items: flex-start;
      }

      .ide-chat-bubble {
        min-width: 0;
        flex: 1;
        padding: 9px 11px;
        border: 1px solid var(--ide-border);
        border-radius: 8px;
        background: #fff;
        line-height: 20px;
      }

      .ide-chat-title {
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }

      .ide-chat-message.is-agent .ide-chat-bubble {
        border-color: #c7d7fe;
        background: #eff6ff;
      }

      .ide-approval {
        margin-bottom: 12px;
        border-radius: 8px;
      }

      .ide-approval-actions {
        margin-top: 8px;
      }

      .ide-agent-runtime {
        display: grid;
        grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
        gap: 10px;
        margin-bottom: 12px;
      }

      .ide-agent-block {
        margin-bottom: 12px;
        border: 1px solid var(--ide-border);
        border-radius: 8px;
        background: #fff;
      }

      .ide-agent-runtime .ide-agent-block {
        margin-bottom: 0;
      }

      .ide-agent-block-head {
        min-height: 36px;
        justify-content: space-between;
        padding: 8px 10px;
        border-bottom: 1px solid var(--ide-border);
      }

      .ide-agent-block .semi-timeline {
        padding: 10px 12px 2px;
      }

      .ide-plan-list {
        display: grid;
        gap: 6px;
        padding: 8px;
      }

      .ide-plan-row {
        gap: 8px;
        min-height: 30px;
        padding: 5px 7px;
        border-radius: 7px;
        background: #fbfcff;
      }

      .ide-plan-row .semi-typography {
        flex: 1;
      }

      .ide-plan-index {
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        color: #6b7280;
        background: #eef2f7;
        font-size: 12px;
        font-weight: 700;
      }

      .ide-plan-index.is-done {
        color: #fff;
        background: var(--ide-green);
      }

      .ide-plan-index.is-running {
        color: #fff;
        background: var(--ide-blue);
      }

      .ide-tool-row {
        gap: 8px;
        min-height: 30px;
        padding: 5px 8px;
      }

      .ide-tool-row .semi-typography:nth-child(2) {
        width: 54px;
      }

      .ide-tool-list {
        padding: 8px 0;
      }

      .ide-agent-composer {
        padding: 12px;
        border-top: 1px solid var(--ide-border);
        background: #fff;
      }

      .ide-composer-meta {
        gap: 6px;
        margin-bottom: 8px;
      }

      .ide-composer-actions {
        justify-content: space-between;
        margin-top: 8px;
      }

      .ide-ok {
        color: var(--ide-green);
      }

      .ide-warn {
        color: var(--ide-orange);
      }

      .ide-spin {
        color: var(--ide-blue);
        animation: ide-spin 1.2s linear infinite;
      }

      .ide-muted-icon {
        color: #aeb6c5;
      }

      @keyframes ide-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 1340px) {
        .ide-body {
          grid-template-columns: 58px 260px minmax(520px, 1fr) 360px;
        }

        .ide-sidebar {
          width: 260px;
          min-width: 260px;
        }

        .ide-agent-panel {
          width: 360px;
          min-width: 360px;
        }

        .ide-agent-runtime {
          grid-template-columns: minmax(0, 1fr);
        }

        .ide-bottom-grid {
          grid-template-columns: minmax(0, 1fr);
        }

        .ide-diff-mini {
          display: none;
        }
      }

      @media (max-width: 1060px) {
        .ide-body {
          grid-template-columns: 54px minmax(0, 1fr) 360px;
        }

        .ide-sidebar,
        .ide-top-actions {
          display: none;
        }

        .ide-topbar {
          grid-template-columns: 250px minmax(0, 1fr);
        }
      }

      @media (max-width: 760px) {
        .ide-shell {
          min-height: 680px;
        }

        .ide-topbar {
          grid-template-columns: 1fr;
          padding: 0 10px;
        }

        .ide-command,
        .ide-rail,
        .ide-agent-panel {
          display: none;
        }

        .ide-body {
          grid-template-columns: minmax(0, 1fr);
          height: calc(100vh - 58px);
        }

        .ide-breadcrumb .semi-space:last-child {
          display: none;
        }

        .ide-code-body {
          font-size: 12px;
        }

        .ide-code-line {
          grid-template-columns: 42px minmax(680px, 1fr);
        }

        .ide-bottom-panel {
          height: 178px;
          flex-basis: 178px;
        }

        .ide-bottom-grid {
          height: 140px;
        }
      }
    `}</style>
  );
}

export default function DeepSeekCodeIDE() {
  return (
    <ConfigProvider>
      <div className="ide-shell">
        <ScopedStyles />
        <TopBar />
        <div className="ide-body">
          <ActivityRail />
          <Sidebar />
          <CodeWorkspace />
          <ChatPanel />
        </div>
      </div>
    </ConfigProvider>
  );
}
