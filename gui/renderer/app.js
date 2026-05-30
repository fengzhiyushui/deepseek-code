// gui/renderer/app.js — App controller + UI State Adapter
(function () {
  "use strict";

  var api = window.deepseek;
  var currentLayer = "surface";
  var eventBuffer = [];
  var unsubKernel = null;

  // ===== UI State Adapter =====

  function adaptEvent(event) {
    eventBuffer.push(event);
    if (eventBuffer.length > 100) eventBuffer.shift();
    updateContextLayer();
    updateStatusBar(event);
    checkApprovalState(event);
  }

  function updateStatusBar(event) {
    if (event && event.state && event.state.entered) {
      setText("status-channel", event.state.entered);
    }
  }

  function updateContextLayer() {
    var recent = eventBuffer.slice(-8);
    var log = document.getElementById("activity-log");
    clearChildren(log);
    for (var i = 0; i < recent.length; i++) {
      var e = recent[i];
      var div = document.createElement("div");
      div.className = "log-entry";
      var icon = document.createElement("span");
      icon.className = "log-icon";
      icon.textContent = eventIcon(e.type);
      div.appendChild(icon);
      var summary = document.createElement("span");
      summary.className = "log-summary";
      summary.textContent = summarizeEvent(e);
      div.appendChild(summary);
      log.appendChild(div);
    }
  }

  function eventIcon(type) {
    var icons = { "user:message": "💬", "orchestrator:state": "🔄", "tool:call": "🔧", "tool:result": "✓", "permission:decision": "🔐", "agent:result": "✅", "agent:error": "❌" };
    return icons[type] || "•";
  }

  function summarizeEvent(e) {
    if (e.type === "user:message") return (e.content || "").slice(0, 60);
    if (e.type === "orchestrator:state") return (e.state?.exited || "?") + " → " + (e.state?.entered || "?");
    if (e.type === "tool:call") return e.tool || "";
    if (e.type === "permission:decision") return e.decision || "";
    if (e.type === "agent:result") return e.result?.status || "complete";
    if (e.type === "agent:error") return "❌ " + (e.error || "");
    return e.type;
  }

  function checkApprovalState(event) {
    if (event && event.type === "orchestrator:state" && event.state?.entered === "awaitapproval") {
      showApprovalBox(event);
    }
  }

  // ===== Three-layer control =====

  function showLayer(layer) {
    currentLayer = layer;
    toggleClass("surface-layer", "hidden", layer !== "surface");
    toggleClass("context-layer", "hidden", layer === "surface");
  }

  function showControlLayer(title, content) {
    setText("control-title", title);
    setText("control-body", content);
    document.getElementById("control-overlay").classList.remove("hidden");
  }

  function hideControlLayer() {
    document.getElementById("control-overlay").classList.add("hidden");
  }

  // ===== Messages =====

  function sendMessage() {
    var input = document.getElementById("msg-input");
    var message = input.value.trim();
    if (!message) return;
    input.value = "";

    addMessage("user", message);
    showLayer("context");

    api.send(message, {}).then(function (response) {
      if (response && response.error) {
        addMessage("assistant", "❌ " + response.error);
        showLayer("surface");
      }
      // Success is delivered via kernel:event (agent:result)
    }).catch(function (err) {
      addMessage("assistant", "❌ " + err.message);
      showLayer("surface");
    });
  }

  function addMessage(role, content) {
    var div = document.createElement("div");
    div.className = "message " + role;
    div.textContent = content;  // XSS-safe: textContent, NOT innerHTML
    document.getElementById("messages").appendChild(div);
    div.scrollIntoView({ behavior: "smooth" });
  }

  // ===== Approval =====

  function showApprovalBox(event) {
    showLayer("surface"); // return to surface to show the card
    var box = document.getElementById("approval-box");
    box.className = "";
    clearChildren(box);

    var card = document.createElement("div");
    card.className = "approval-card";

    var title = document.createElement("div");
    title.className = "approval-title";
    title.textContent = "⚠ 需要确认";
    card.appendChild(title);

    var typeDiv = document.createElement("div");
    typeDiv.className = "approval-type";
    typeDiv.textContent = (event.transition?.approval?.type) || "plan";
    card.appendChild(typeDiv);

    var actions = document.createElement("div");
    actions.className = "approval-actions";

    var btnApprove = document.createElement("button");
    btnApprove.textContent = "✓ 同意";
    btnApprove.onclick = function () {
      api.approve("approval", "allow");
      box.className = "hidden";
      clearChildren(box);
    };
    actions.appendChild(btnApprove);

    var btnDeny = document.createElement("button");
    btnDeny.textContent = "✗ 拒绝";
    btnDeny.onclick = function () {
      api.approve("approval", "deny");
      box.className = "hidden";
      clearChildren(box);
    };
    actions.appendChild(btnDeny);

    card.appendChild(actions);
    box.appendChild(card);
  }

  // ===== Event listeners =====

  document.getElementById("btn-send").onclick = sendMessage;
  document.getElementById("msg-input").onkeydown = function (e) {
    if (e.key === "Enter") sendMessage();
  };
  document.getElementById("btn-context").onclick = function () {
    showLayer(currentLayer === "context" ? "surface" : "context");
  };
  document.getElementById("btn-close-context").onclick = function () {
    showLayer("surface");
  };
  document.getElementById("btn-control").onclick = function () {
    if (currentLayer === "control") {
      hideControlLayer();
    } else {
      // Show plan/review info from recent events
      var planEvents = eventBuffer.filter(function (e) {
        return e.type === "orchestrator:state";
      });
      var content = planEvents.map(summarizeEvent).join("\n") || "No plan data yet.";
      showControlLayer("Plan Review", content);
    }
  };
  document.getElementById("btn-close-control").onclick = hideControlLayer;

  // ===== Kernel events =====

  unsubKernel = api.onKernelEvent(function (event) {
    adaptEvent(event);
    // Handle agent result
    if (event.type === "agent:result") {
      addMessage("assistant", event.result?.content || "Done.");
      showLayer("surface");
    }
    if (event.type === "agent:error") {
      addMessage("assistant", "❌ " + (event.error || "Error"));
      showLayer("surface");
    }
  });

  // ===== Status poll =====

  setInterval(function () {
    api.getUsage().then(function (usage) {
      api.getState().then(function (state) {
        var total = (usage.total_prompt_tokens || 0) + (usage.total_completion_tokens || 0);
        setText("status-tokens", total >= 1000 ? (total / 1000).toFixed(1) + "K tokens" : total + " tokens");
        setText("status-autonomy", state.autonomy || "gated");
        setText("status-channel", state.channel || "—");
        if (usage.requests > 0) {
          var denom = (usage.cache_hit_tokens || 0) + (usage.cache_miss_tokens || 0);
          var rate = denom > 0 ? Math.round(usage.cache_hit_tokens / denom * 100) : 0;
          setText("status-cache", "cache " + rate + "%");
        }
      });
    });
  }, 2000);

  // ===== Helpers =====

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function toggleClass(id, cls, add) {
    var el = document.getElementById(id);
    if (!el) return;
    if (add) el.classList.add(cls); else el.classList.remove(cls);
  }
})();
