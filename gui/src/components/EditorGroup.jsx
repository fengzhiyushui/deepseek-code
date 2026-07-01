import React, { useState } from "react";

export default function EditorGroup({ t }) {
  const [ptab, setPtab] = useState("terminal");
  const ptabs = [
    { k: "problems", label: t("panel.problems") },
    { k: "output", label: t("panel.output") },
    { k: "debug", label: t("panel.debug") },
    { k: "terminal", label: t("panel.terminal") }
  ];
  return (
    <div className="editor" aria-label="editor">
      <div className="tabs" role="tablist" aria-label="open editors">
        <div className="tab active" role="tab" aria-selected="true"><span className="ico js" style={{ width: 14, height: 14, fontSize: 9 }}>JS</span> index.js <span className="x" aria-hidden="true">✕</span></div>
        <div className="tab" role="tab" aria-selected="false"><span className="ico js" style={{ width: 14, height: 14, fontSize: 9 }}>JS</span> config.js <span className="dot" /></div>
        <div className="tab" role="tab" aria-selected="false"><span className="ico md" style={{ width: 14, height: 14, fontSize: 9 }}>MD</span> README.md <span className="x" aria-hidden="true">✕</span></div>
      </div>

      <div className="breadcrumb" aria-label="breadcrumb">
        src <span className="sep">›</span> core <span className="sep">›</span> index.js <span className="sep">›</span> <span className="fn">createKernel</span>
        <span style={{ marginLeft: "auto", color: "var(--text-mut)", fontSize: 10 }}>{t("placeholder.badge")}</span>
      </div>

      <div className="code" role="document" aria-label={t("placeholder.editor")}>
        <table>
          <tbody>
            <tr><td className="ln">1</td><td className="src"><span className="c">{"// createKernel(root, options) — composition root"}</span></td></tr>
            <tr><td className="ln">2</td><td className="src"><span className="k">import</span>{" { createAgentRuntime } "}<span className="k">from</span> <span className="s">"./core/runtime/agent-runtime.js"</span>;</td></tr>
            <tr><td className="ln">3</td><td className="src"><span className="k">import</span>{" { createTaskRouter } "}<span className="k">from</span> <span className="s">"./core/orchestration/task-router.js"</span>;</td></tr>
            <tr><td className="ln">4</td><td className="src"> </td></tr>
            <tr><td className="ln">5</td><td className="src"><span className="k">export</span> <span className="k">function</span> <span className="fn">createKernel</span>(<span className="v">root</span>, <span className="v">options</span> = {"{}"}) {"{"}</td></tr>
            <tr><td className="ln">6</td><td className="src">{"  "}<span className="k">const</span> <span className="v">router</span> = <span className="fn">createTaskRouter</span>(options.<span className="v">orchestration</span>?.<span className="v">router</span>);</td></tr>
            <tr className="cur"><td className="ln">7</td><td className="src">{"  "}<span className="k">const</span> <span className="v">runtime</span> = <span className="fn">createAgentRuntime</span>({"{ "}<span className="v">root</span>, ...options {"}"});</td></tr>
            <tr><td className="ln">8</td><td className="src"> </td></tr>
            <tr><td className="ln">9</td><td className="src">{"  "}<span className="k">async</span> <span className="k">function</span> <span className="fn">routedSend</span>(<span className="v">message</span>, <span className="v">opts</span>) {"{"}</td></tr>
            <tr><td className="ln">10</td><td className="src">{"    "}<span className="k">const</span> <span className="v">decision</span> = <span className="k">await</span> router.<span className="fn">route</span>(<span className="v">message</span>, <span className="v">opts</span>);</td></tr>
            <tr><td className="ln">11</td><td className="src">{"    "}<span className="k">return</span> <span className="v">decision</span>.<span className="v">lane</span> === <span className="s">"single"</span></td></tr>
            <tr><td className="ln">12</td><td className="src">{"      ? runtime."}<span className="fn">send</span>(<span className="v">message</span>, <span className="v">opts</span>)</td></tr>
            <tr><td className="ln">13</td><td className="src">{"      : orchestrator."}<span className="fn">run</span>({"{ "}<span className="v">message</span>, <span className="v">opts</span> {"}"});</td></tr>
            <tr><td className="ln">14</td><td className="src">{"  }"}</td></tr>
            <tr><td className="ln">15</td><td className="src">{"  "}<span className="k">return</span> {"{ "}<span className="v">agent</span>: {"{ "}<span className="v">send</span>: <span className="v">routedSend</span> {"}"}, <span className="v">runtime</span> {"}"};</td></tr>
            <tr><td className="ln">16</td><td className="src">{"}"}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel-tabs" role="tablist" aria-label="panel">
        {ptabs.map((p) => (
          <button key={p.k} type="button" role="tab" aria-selected={ptab === p.k} className={`pt ${ptab === p.k ? "active" : ""}`} onClick={() => setPtab(p.k)}>{p.label}</button>
        ))}
        <span className="grow" />
        <span style={{ color: "var(--text-mut)", fontSize: 10 }}>{t("placeholder.badge")}</span>
      </div>
      <div className="panel" aria-label={t("placeholder.terminal")}>
        <div><span className="prompt">➜</span> <span className="path">deepseek-code</span> npm test</div>
        <div className="dim">▶ node --test tests/ test/</div>
        <div><span className="ok">✔</span> 797 {t("status.passing")} <span className="dim">(4.1s)</span></div>
        <div><span className="prompt">➜</span> <span className="path">deepseek-code</span> <span style={{ color: "var(--text-bright)" }}>▍</span></div>
      </div>
    </div>
  );
}
