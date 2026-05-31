// gui/renderer/app.js - Workbench DOM controller
(function () {
  "use strict";

  var api = window.deepseek;
  var adapter = window.DeepSeekEventAdapter;
  var model = window.DeepSeekWorkbenchState;
  var state = model.createInitialState();

  function dispatch(action) {
    state = model.applyWorkbenchAction(state, action);
    render();
  }

  function init() {
    bindDom();
    refreshWorkbench();
    api.onKernelEvent(function (event) {
      dispatch({ type: "event_received", event: event });
      var status = adapter.statusFromEvent(event);
      if (status.channel) dispatch({ type: "status_channel_changed", channel: status.channel });
      checkApprovalState(event);
      if (event.type === "agent:final") addMessage("assistant", event.content || "Done.");
      if (event.type === "agent:error") addMessage("assistant", "Error: " + (event.error || event.message || "Unknown error"));
    });
    setInterval(refreshMetrics, 2000);
  }

  function bindDom() {
    document.getElementById("composer").onsubmit = function (event) {
      event.preventDefault();
      sendMessage();
    };
    document.getElementById("btn-refresh").onclick = refreshWorkbench;
    document.getElementById("rewind-force").onchange = function (event) {
      dispatch({ type: "force_rewind_changed", force: event.target.checked });
      renderRewindPreview();
    };
    document.getElementById("rewind-apply").onclick = applyRewind;
  }

  function refreshWorkbench() {
    Promise.all([api.listBranches(), api.getActiveBranch()]).then(function (values) {
      var branches = values[0];
      var activeBranch = values[1];
      if (branches && branches.error) throw new Error(branches.error);
      if (activeBranch && activeBranch.error) throw new Error(activeBranch.error);
      var active = activeBranch?.branch_id || "br_main";
      dispatch({ type: "branches_loaded", branches: branches || [], activeBranchId: active });
      return loadCheckpoints(active);
    }).catch(function (error) {
      addMessage("assistant", "GUI refresh failed: " + error.message);
    });
    refreshMetrics();
  }

  function loadCheckpoints(branchId) {
    return api.listCheckpoints({ branch_id: branchId || state.selectedBranchId }).then(function (checkpoints) {
      if (checkpoints && checkpoints.error) throw new Error(checkpoints.error);
      dispatch({ type: "checkpoints_loaded", checkpoints: checkpoints || [] });
    });
  }

  function refreshMetrics() {
    api.getUsage().then(function (usage) {
      dispatch({ type: "usage_loaded", usage: usage || {} });
      return api.getState();
    }).then(function (runtime) {
      dispatch({ type: "runtime_loaded", runtime: runtime || { current: "idle" } });
    }).catch(function () {});
  }

  function sendMessage() {
    var input = document.getElementById("msg-input");
    var message = input.value.trim();
    if (!message) return;
    input.value = "";
    addMessage("user", message);
    api.send(message, {}).then(function (response) {
      if (response && response.error) addMessage("assistant", "Error: " + response.error);
    }).catch(function (error) {
      addMessage("assistant", "Error: " + error.message);
    });
  }

  function previewCheckpoint(checkpoint) {
    dispatch({ type: "checkpoint_selected", checkpoint: checkpoint });
    api.rewindPreview({ target: model.targetFromCheckpoint(checkpoint) }).then(function (preview) {
      if (preview && preview.error) throw new Error(preview.error);
      dispatch({ type: "rewind_preview_loaded", preview: preview });
    }).catch(function (error) {
      dispatch({ type: "rewind_result_loaded", result: { status: "error", reason: error.message } });
    });
  }

  function applyRewind() {
    if (!state.rewindPreview || !state.selectedTarget) return;
    api.rewindApply({ target: state.selectedTarget, force: state.forceRewind }).then(function (result) {
      if (result && result.error) throw new Error(result.error);
      dispatch({ type: "rewind_result_loaded", result: result });
      refreshWorkbench();
    }).catch(function (error) {
      dispatch({ type: "rewind_result_loaded", result: { status: "error", reason: error.message } });
    });
  }

  function addMessage(role, content) {
    dispatch({ type: "message_added", message: { role: role, content: content } });
  }

  function render() {
    renderBranches();
    renderCheckpoints();
    renderMessages();
    renderActivity();
    renderRewindPreview();
    renderStatus();
  }

  function renderBranches() {
    var list = document.getElementById("branch-list");
    clearChildren(list);
    if (!state.branches.length) {
      appendText(list, "div", "branch-meta", "No branches yet");
      return;
    }
    state.branches.forEach(function (branch) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "branch-item" + (branch.branch_id === state.activeBranchId ? " active" : "");
      button.onclick = function () {
        dispatch({ type: "branch_selected", branch_id: branch.branch_id });
        loadCheckpoints(branch.branch_id);
      };
      appendText(button, "div", "branch-title", model.shortId(branch.branch_id));
      appendText(button, "div", "branch-meta", branch.label || branch.parent_branch_id || "main");
      list.appendChild(button);
    });
  }

  function renderCheckpoints() {
    var list = document.getElementById("checkpoint-list");
    clearChildren(list);
    if (!state.checkpoints.length) {
      appendText(list, "div", "checkpoint-meta", "No checkpoints yet");
      return;
    }
    state.checkpoints.slice().reverse().slice(0, 30).forEach(function (checkpoint) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "checkpoint-item";
      item.onclick = function () { previewCheckpoint(checkpoint); };
      appendText(item, "div", "checkpoint-title", checkpoint.turn_id || checkpoint.event_id || ("seq " + checkpoint.seq));
      appendText(item, "div", "checkpoint-meta", (checkpoint.cumulative_change_ids || []).length + " changes");
      list.appendChild(item);
    });
  }

  function renderMessages() {
    var box = document.getElementById("messages");
    clearChildren(box);
    state.messages.forEach(function (message) {
      var div = document.createElement("div");
      div.className = "message " + message.role;
      div.textContent = message.content;
      box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
  }

  function renderActivity() {
    var log = document.getElementById("activity-log");
    clearChildren(log);
    state.activity.slice(-12).forEach(function (event) {
      var div = document.createElement("div");
      div.className = "activity-item";
      appendText(div, "div", "branch-title", adapter.eventIcon(event.type) + " " + adapter.summarizeEvent(event));
      appendText(div, "div", "activity-meta", event.branch_id || "");
      log.appendChild(div);
    });
  }

  function renderRewindPreview() {
    var box = document.getElementById("rewind-preview");
    clearChildren(box);
    if (state.rewindPreview) {
      box.className = "rewind-preview";
      appendText(box, "div", "branch-title", "Preview: " + (state.rewindPreview.rollback_count || 0) + " changes");
      appendText(box, "div", "checkpoint-meta", "Branch " + (state.rewindPreview.planned_branch_id || "planned"));
      appendText(box, "div", "checkpoint-meta", "Files: " + ((state.rewindPreview.files || []).join(", ") || "none"));
    } else {
      box.className = "rewind-preview empty";
      box.textContent = "Select a checkpoint to preview rewind.";
    }
    if (state.rewindResult) {
      appendText(box, "div", "checkpoint-meta", model.formatRewindStatus(state.rewindResult));
    }
    document.getElementById("rewind-apply").disabled = !state.rewindPreview;
  }

  function renderStatus() {
    var metrics = state.metrics || {};
    setText("metric-tokens", metrics.tokens || "0");
    setText("metric-cache", metrics.cacheRate || "0%");
    setText("metric-latency", metrics.latency || "0ms");
    setText("metric-requests", metrics.requests || "0");
    setText("status-branch", state.activeBranchId || "br_main");
    setText("status-autonomy", state.runtime?.autonomy || "gated");
    setText("status-channel", state.statusChannel || state.runtime?.channel || "idle");
    setText("status-runtime", state.runtime?.current || "idle");
  }

  function showApprovalBox(approval) {
    var box = document.getElementById("approval-box");
    box.className = "";
    clearChildren(box);
    var card = document.createElement("div");
    card.className = "approval-card";
    appendText(card, "div", "approval-title", "Approval required");
    appendText(card, "div", "approval-type", approval.summary || approval.id);
    var actions = document.createElement("div");
    actions.className = "approval-actions";
    var allow = document.createElement("button");
    allow.type = "button";
    allow.textContent = "Allow";
    allow.onclick = function () { resolveApproval(approval.id, "allow"); };
    var deny = document.createElement("button");
    deny.type = "button";
    deny.textContent = "Deny";
    deny.onclick = function () { resolveApproval(approval.id, "deny"); };
    actions.appendChild(allow);
    actions.appendChild(deny);
    card.appendChild(actions);
    box.appendChild(card);
  }

  function resolveApproval(id, decision) {
    api.approve(id, decision).finally(function () {
      var box = document.getElementById("approval-box");
      box.className = "hidden";
      clearChildren(box);
    });
  }

  function checkApprovalState(event) {
    var approval = adapter.getApproval(event);
    if (approval) showApprovalBox(approval);
  }

  function appendText(parent, tag, className, text) {
    var el = document.createElement(tag);
    el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function clearChildren(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  init();
})();
