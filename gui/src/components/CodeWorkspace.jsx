import React from "react";
import Placeholder from "./Placeholder.jsx";

const SAMPLE = `// static preview — a real editor (Monaco) arrives in D-2
export function greet(name) {
  return "hello " + name;
}`;

export default function CodeWorkspace() {
  return (
    <main className="panel workspace" aria-label="code workspace">
      <div className="section-title">Editor · index.js</div>
      <Placeholder label="示例编辑器(静态预览,未接入真实文件)">
        <pre className="editor-pre">{SAMPLE}</pre>
      </Placeholder>

      <div className="section-title">Terminal</div>
      <Placeholder label="示例终端(未接入 xterm)">
        <div style={{ fontFamily: "ui-monospace, monospace" }}>$ deepseek-code test</div>
        <div style={{ fontFamily: "ui-monospace, monospace", color: "var(--ide-green)" }}>✔ 795 passing</div>
      </Placeholder>
    </main>
  );
}
