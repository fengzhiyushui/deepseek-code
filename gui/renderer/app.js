// gui/renderer/app.js — App controller + UI State Adapter
(function () {
  "use strict";

  var api = window.deepseek;
  var adapter = window.DeepSeekEventAdapter;
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
    var status = adapter.statusFromEvent(event);
    if (status.channel) setText("status-channel", status.channel);
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
    return adapter.eventIcon(type);
  }

  function summarizeEvent(e) {
    return adapter.summarizeEvent(e);
  }

  function checkApprovalState(event) {
    var approval = adapter.getApproval(event);
    if (approval) showApprovalBox(approval);
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

  function showApprovalBox(approval) {
    showLayer("surface");
    var box = document.getElementById("approval-box");
    box.className = "";
    clearChildren(box);

    var card = document.createElement("div");
    card.className = "approval-card";

    var title = document.createElement("div");
    title.className = "approval-title";
    title.textContent = "Approval required";
    card.appendChild(title);

    var typeDiv = document.createElement("div");
    typeDiv.className = "approval-type";
    typeDiv.textContent = approval.summary || approval.id;
    card.appendChild(typeDiv);

    var actions = document.createElement("div");
    actions.className = "approval-actions";

    var btnApprove = document.createElement("button");
    btnApprove.textContent = "Allow";
    btnApprove.onclick = function () {
      api.approve(approval.id, "allow");
      box.className = "hidden";
      clearChildren(box);
    };
    actions.appendChild(btnApprove);

    var btnDeny = document.createElement("button");
    btnDeny.textContent = "Deny";
    btnDeny.onclick = function () {
      api.approve(approval.id, "deny");
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
    // Handle V2 agent events
    if (event.type === "agent:final") {
      addMessage("assistant", event.content || "Done.");
      showLayer("surface");
    }
    if (event.type === "agent:result") {
      addMessage("assistant", event.result?.content || "Done.");
      showLayer("surface");
    }
    if (event.type === "agent:error") {
      addMessage("assistant", "Error: " + (event.error || event.message || "Unknown error"));
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
