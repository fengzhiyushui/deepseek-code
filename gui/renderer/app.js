// gui/renderer/app.js - Natural agent workbench DOM controller
(function () {
  "use strict";

  var hasBridge = Boolean(window.deepseek);
  var api = window.deepseek || createFallbackApi();
  var adapter = window.DeepSeekEventAdapter || createFallbackAdapter();
  var model = window.DeepSeekWorkbenchState;
  var state = model.createInitialState();

  function dispatch(action) {
    var next = model.applyWorkbenchAction(state, action);
    if (isCompactViewport() && next.inspectorMode !== "activity" && next.contextCollapsed === false) {
      next = model.applyWorkbenchAction(next, { type: "context_collapsed_changed", collapsed: true });
    }
    state = next;
    render();
  }

  function init() {
    bindDom();
    bindKeyboardShortcuts();
    if (isCompactViewport()) {
      state = model.applyWorkbenchAction(state, { type: "context_collapsed_changed", collapsed: true });
      render();
    }
    loadPreferences();
    if (!hasBridge) {
      reportError("runtime", "GUI bridge unavailable. Workbench is running in preview mode.");
      dispatch({ type: "inspector_closed" });
    }
    refreshWorkbench();
    if (typeof api.onKernelEvent !== "function") {
      reportError("runtime", "Kernel event stream unavailable.");
      return;
    }
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
    document.getElementById("theme-toggle").onclick = function () {
      dispatch({ type: "theme_changed", theme: state.theme === "night" ? "day" : "night" });
      persistPreferences();
    };
    document.getElementById("context-collapse").onclick = function () {
      dispatch({ type: "context_collapsed_changed", collapsed: !state.contextCollapsed });
      persistPreferences();
    };
    document.getElementById("rewind-force").onchange = function (event) {
      dispatch({ type: "force_rewind_changed", force: event.target.checked });
      renderRewindPreview();
    };
    document.getElementById("rewind-apply").onclick = applyRewind;
    document.getElementById("inspector-close").onclick = function () {
      dispatch({ type: "inspector_closed" });
      focusComposer();
    };
    document.querySelectorAll("[data-rail]").forEach(function (button) {
      button.onclick = function () {
        dispatch({ type: "rail_mode_changed", mode: button.getAttribute("data-rail") });
        persistPreferences();
      };
    });
    document.querySelectorAll("[data-inspector]").forEach(function (tab) {
      tab.onclick = function () {
        dispatch({ type: "inspector_mode_changed", mode: tab.getAttribute("data-inspector") });
      };
    });
  }

  function loadPreferences() {
    if (typeof api.getPreferences !== "function") return;
    api.getPreferences().then(function (preferences) {
      if (preferences && preferences.error) throw new Error(preferences.error);
      var next = preferences || {};
      if (isCompactViewport()) next = Object.assign({}, next, { contextCollapsed: true });
      dispatch({ type: "preferences_loaded", preferences: next });
    }).catch(function (error) {
      reportError("preferences", error);
    });
  }

  function persistPreferences() {
    if (typeof api.setPreferences !== "function") return;
    api.setPreferences({
      theme: state.theme,
      railMode: state.railMode,
      contextCollapsed: state.contextCollapsed
    }).catch(function (error) {
      reportError("preferences", error);
    });
  }

  function bindKeyboardShortcuts() {
    var composerShortcut = "Ctrl+K";
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (closeTopDrawer()) event.preventDefault();
        return;
      }
      if (isTextEditing(event.target)) return;
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusComposer(composerShortcut);
        return;
      }
      if (event.ctrlKey && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        var modes = ["chat", "context", "branches", "timeline", "settings"];
        dispatch({ type: "rail_mode_changed", mode: modes[Number(event.key) - 1] });
        persistPreferences();
      }
    });
  }

  function closeTopDrawer() {
    if (state.inspectorMode !== "activity") {
      dispatch({ type: "inspector_closed" });
      focusComposer();
      return true;
    }
    if (state.contextCollapsed === false && isCompactViewport()) {
      dispatch({ type: "context_collapsed_changed", collapsed: true });
      persistPreferences();
      focusComposer();
      return true;
    }
    return false;
  }

  function focusComposer() {
    var input = document.getElementById("msg-input");
    if (input) input.focus();
  }

  function focusInspector() {
    var close = document.getElementById("inspector-close");
    if (close && state.inspectorMode !== "activity") close.focus();
  }

  function isTextEditing(target) {
    if (!target) return false;
    var tag = String(target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || target.isContentEditable;
  }

  function isCompactViewport() {
    return Boolean(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
  }

  function refreshWorkbench() {
    dispatch({ type: "loading_changed", key: "branches", value: true });
    Promise.all([api.listBranches(), api.getActiveBranch()]).then(function (values) {
      var branches = values[0];
      var activeBranch = values[1];
      if (branches && branches.error) throw new Error(branches.error);
      if (activeBranch && activeBranch.error) throw new Error(activeBranch.error);
      var active = activeBranch?.branch_id || "br_main";
      dispatch({ type: "branches_loaded", branches: branches || [], activeBranchId: active });
      dispatch({ type: "loading_changed", key: "branches", value: false });
      return loadCheckpoints(active);
    }).catch(function (error) {
      reportError("branches", error);
    });
    refreshMetrics();
  }

  function loadCheckpoints(branchId) {
    dispatch({ type: "loading_changed", key: "checkpoints", value: true });
    return api.listCheckpoints({ branch_id: branchId || state.selectedBranchId }).then(function (checkpoints) {
      if (checkpoints && checkpoints.error) throw new Error(checkpoints.error);
      dispatch({ type: "checkpoints_loaded", checkpoints: checkpoints || [] });
      dispatch({ type: "loading_changed", key: "checkpoints", value: false });
    }).catch(function (error) {
      reportError("checkpoints", error);
    });
  }

  function refreshMetrics() {
    api.getUsage().then(function (usage) {
      dispatch({ type: "usage_loaded", usage: usage || {} });
      return api.getState();
    }).then(function (runtime) {
      dispatch({ type: "runtime_loaded", runtime: runtime || { current: "idle" } });
    }).catch(function (error) {
      reportError("metrics", error);
    });
  }

  function sendMessage() {
    var input = document.getElementById("msg-input");
    var message = input.value.trim();
    if (!message) return;
    input.value = "";
    addMessage("user", message);
    dispatch({ type: "loading_changed", key: "message", value: true });
    api.send(message, {}).then(function (response) {
      dispatch({ type: "loading_changed", key: "message", value: false });
      if (response && response.error) reportError("message", response.error);
    }).catch(function (error) {
      reportError("message", error);
    });
  }

  function previewCheckpoint(checkpoint) {
    dispatch({ type: "checkpoint_selected", checkpoint: checkpoint });
    dispatch({ type: "loading_changed", key: "rewind", value: true });
    api.rewindPreview({ target: model.targetFromCheckpoint(checkpoint) }).then(function (preview) {
      if (preview && preview.error) throw new Error(preview.error);
      dispatch({ type: "rewind_preview_loaded", preview: preview });
      focusInspector();
      dispatch({ type: "loading_changed", key: "rewind", value: false });
    }).catch(function (error) {
      reportError("rewind", error);
      dispatch({ type: "rewind_result_loaded", result: { status: "error", reason: error.message } });
    });
  }

  function applyRewind() {
    if (!state.rewindPreview || !state.selectedTarget) return;
    dispatch({ type: "loading_changed", key: "rewind", value: true });
    api.rewindApply({ target: state.selectedTarget, force: state.forceRewind }).then(function (result) {
      if (result && result.error) throw new Error(result.error);
      dispatch({ type: "rewind_result_loaded", result: result });
      dispatch({ type: "loading_changed", key: "rewind", value: false });
      refreshWorkbench();
    }).catch(function (error) {
      reportError("rewind", error);
      dispatch({ type: "rewind_result_loaded", result: { status: "error", reason: error.message } });
    });
  }

  function addMessage(role, content) {
    dispatch({ type: "message_added", message: { role: role, content: content } });
  }

  function reportError(area, error) {
    dispatch({ type: "error_reported", area: area, message: errorMessage(error) });
  }

  function render() {
    renderTheme();
    renderErrors();
    renderCommandBar();
    renderContextPanel();
    renderEmptyState();
    renderBranches();
    renderCheckpoints();
    renderMessages();
    renderActivity();
    renderRewindPreview();
    renderInspector();
    renderStatus();
    renderStatusline();
  }

  function renderTheme() {
    var app = document.getElementById("app");
    if (app) {
      var classes = ["workbench-shell"];
      if (state.inspectorMode !== "activity") classes.push("inspector-open");
      if (!state.contextCollapsed) classes.push("context-open");
      app.className = classes.join(" ");
      app.setAttribute("data-theme", state.theme);
    }
    setText("theme-toggle", state.theme === "night" ? "Night" : "Day");
  }

  function renderCommandBar() {
    var summary = model.statusSummary(state);
    setText("command-branch", summary.branch);
    setText("command-task", commandTaskText());
    setText("command-detail", summary.runtime + " / " + summary.channel + " / " + model.themeLabel(state.theme));
    var traffic = document.getElementById("traffic-light");
    var tone = trafficTone(state);
    if (traffic) traffic.setAttribute("data-tone", tone);
    setText("traffic-light-label", trafficLabel(tone, state));
  }

  function renderContextPanel() {
    var panel = document.getElementById("context-panel");
    if (panel) panel.className = "context-panel" + (state.contextCollapsed ? " collapsed" : "");
    var collapse = document.getElementById("context-collapse");
    if (collapse) collapse.setAttribute("aria-label", state.contextCollapsed ? "Expand context panel" : "Collapse context panel");
    document.querySelectorAll("[data-rail]").forEach(function (button) {
      var selected = button.getAttribute("data-rail") === state.railMode;
      button.className = "rail-button" + (selected ? " selected" : "");
    });
    setText("context-panel-title", contextTitle(state.railMode));
    setText("context-panel-subtitle", contextSubtitle(state.railMode));
    setText("context-mode-copy", contextCopy(state.railMode));
    setText("active-branch-pill", state.selectedBranchId || state.activeBranchId || "br_main");
  }

  function renderEmptyState() {
    var box = document.getElementById("empty-state");
    if (!box) return;
    box.className = state.emptyStateVisible ? "empty-state" : "empty-state hidden";
    setText("empty-branch", state.activeBranchId || "br_main");
    setText("empty-runtime", state.runtime?.current || "idle");
    setText("empty-cache", state.metrics?.cacheRate || "0%");
  }

  function renderErrors() {
    var strip = document.getElementById("error-strip");
    if (!strip) return;
    clearChildren(strip);
    if (!state.errors.length) {
      strip.className = "error-strip hidden";
      return;
    }
    strip.className = "error-strip";
    var latest = state.errors[state.errors.length - 1];
    strip.textContent = latest.area + ": " + latest.message;
  }

  function renderBranches() {
    var list = document.getElementById("branch-list");
    list.className = "branch-list" + (state.loading.branches ? " is-loading" : "");
    clearChildren(list);
    if (!state.branches.length) {
      appendText(list, "div", "branch-meta", "No branches yet");
      return;
    }
    state.branches.forEach(function (branch) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = branchClassName(branch);
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
    list.className = "checkpoint-list" + (state.loading.checkpoints ? " is-loading" : "");
    clearChildren(list);
    if (!state.checkpoints.length) {
      appendText(list, "div", "checkpoint-meta", "No checkpoints yet");
      return;
    }
    state.checkpoints.slice().reverse().slice(0, 30).forEach(function (checkpoint) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = checkpointClassName(checkpoint);
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
    if (!state.activity.length) {
      appendText(log, "div", "activity-meta", "No activity yet");
      return;
    }
    state.activity.slice(-14).forEach(function (event) {
      var div = document.createElement("div");
      div.className = "activity-item";
      appendText(div, "div", "branch-title", adapter.eventIcon(event.type) + " " + adapter.summarizeEvent(event));
      appendText(div, "div", "activity-meta", (event.branch_id || "session") + " / " + (event.type || "event"));
      log.appendChild(div);
    });
  }

  function renderRewindPreview() {
    var box = document.getElementById("rewind-preview");
    clearChildren(box);
    if (state.rewindPreview) {
      box.className = "rewind-preview" + (state.loading.rewind ? " is-loading" : "");
      appendText(box, "div", "branch-title", "Preview: " + (state.rewindPreview.rollback_count || 0) + " changes");
      appendText(box, "div", "checkpoint-meta", "Branch " + (state.rewindPreview.planned_branch_id || "planned"));
      appendText(box, "div", "checkpoint-meta", "Files: " + ((state.rewindPreview.files || []).join(", ") || "none"));
    } else {
      box.className = "rewind-preview empty" + (state.loading.rewind ? " is-loading" : "");
      box.textContent = "Select a checkpoint to preview rewind.";
    }
    if (state.rewindResult) {
      appendText(box, "div", "checkpoint-meta", model.formatRewindStatus(state.rewindResult));
    }
    document.getElementById("rewind-apply").disabled = !state.rewindPreview || state.loading.rewind;
  }

  function renderInspector() {
    var inspector = document.getElementById("contextual-inspector");
    if (inspector) {
      var open = state.inspectorMode !== "activity";
      inspector.className = "contextual-inspector" + (open ? " drawer-open" : "");
    }
    document.querySelectorAll("[data-inspector]").forEach(function (tab) {
      var mode = tab.getAttribute("data-inspector");
      var selected = mode === normalizedInspectorTab(state.inspectorMode);
      tab.className = "inspector-tab" + (selected ? " selected" : "");
    });
    setText("inspector-title", inspectorTitle(state.inspectorMode));
    setText("inspector-subtitle", inspectorSubtitle(state.inspectorMode));
  }

  function renderStatus() {
    var metrics = state.metrics || {};
    setText("metric-tokens", metrics.tokens || "0");
    setText("metric-cache", metrics.cacheRate || "0%");
    setText("metric-latency", metrics.latency || "0ms");
    setText("metric-requests", metrics.requests || "0");
    var send = document.getElementById("btn-send");
    if (send) {
      send.className = state.loading.message ? "is-loading" : "";
      send.disabled = Boolean(state.loading.message);
    }
    var refresh = document.getElementById("btn-refresh");
    if (refresh) refresh.className = "icon-button" + (state.loading.branches ? " is-loading" : "");
  }

  function renderStatusline() {
    var metrics = state.metrics || {};
    setText("status-autonomy", state.runtime?.autonomy || "gated");
    setText("status-channel", state.statusChannel || state.runtime?.channel || "idle");
    setText("status-runtime", state.runtime?.current || "idle");
    setText("statusline-branch", state.activeBranchId || "br_main");
    setText("statusline-cache", "cache " + (metrics.cacheRate || "0%"));
    setText("statusline-latency", metrics.latency || "0ms");
  }

  function showApprovalBox(approval) {
    dispatch({ type: "approval_loaded", approval: approval });
    focusInspector();
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
    dispatch({ type: "loading_changed", key: "approval", value: true });
    api.approve(id, decision).finally(function () {
      dispatch({ type: "loading_changed", key: "approval", value: false });
      dispatch({ type: "approval_cleared" });
      var box = document.getElementById("approval-box");
      box.className = "hidden";
      clearChildren(box);
    });
  }

  function checkApprovalState(event) {
    var approval = adapter.getApproval(event);
    if (approval) showApprovalBox(approval);
  }

  function commandTaskText() {
    if (state.approval) return "Approval required";
    if (state.rewindPreview) return "Rewind preview ready";
    if (state.loading.message) return "Agent is working";
    if (state.errors.length) return "Needs attention";
    return state.messages.length ? "Conversation active" : "Ready for local work";
  }

  function contextTitle(mode) {
    var titles = {
      chat: "Chat Context",
      context: "Project Context",
      branches: "Branches",
      timeline: "Timeline",
      settings: "Settings"
    };
    return titles[mode] || titles.chat;
  }

  function contextSubtitle(mode) {
    var subtitles = {
      chat: "Branch, cache, and approvals",
      context: "Indexed files and cache health",
      branches: "Active line of work",
      timeline: "Recent session events",
      settings: "Theme and runtime preferences"
    };
    return subtitles[mode] || subtitles.chat;
  }

  function contextCopy(mode) {
    if (mode === "context") return "Context cache and snapshot details are summarized in metrics. Pinned files can be surfaced here in a later pass.";
    if (mode === "branches") return "Select a branch below to inspect checkpoints and rewind targets.";
    if (mode === "timeline") return "Recent events are shown in the inspector. Timeline mode keeps activity one click away.";
    if (mode === "settings") return "Use the theme control in the command bar to switch between Night Workbench and Day Review.";
    return "Use the composer to start a turn. Approvals and risky actions move into the inspector.";
  }

  function inspectorTitle(mode) {
    if (mode === "approval") return "Approval";
    if (mode === "rewind") return "Rewind";
    if (mode === "details") return "Details";
    if (mode === "checkpoints") return "Checkpoints";
    if (mode === "branch") return "Branch";
    return "Activity";
  }

  function inspectorSubtitle(mode) {
    if (mode === "approval") return "Review risk before continuing";
    if (mode === "rewind") return "Preview rollback before applying";
    if (mode === "details") return "Errors and recovery signals";
    if (mode === "checkpoints") return "Choose a return point";
    if (mode === "branch") return "Branch checkpoints and ancestry";
    return "Recent agent events";
  }

  function normalizedInspectorTab(mode) {
    if (mode === "rewind" || mode === "approval") return "rewind";
    if (mode === "checkpoints" || mode === "branch") return "checkpoints";
    return "activity";
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

  function branchClassName(branch) {
    var classes = ["branch-item"];
    if (branch.branch_id === state.activeBranchId) classes.push("active");
    if (branch.branch_id === state.selectedBranchId) classes.push("selected");
    return classes.join(" ");
  }

  function checkpointClassName(checkpoint) {
    var classes = ["checkpoint-item"];
    if (sameCheckpoint(checkpoint, state.selectedCheckpoint)) classes.push("selected");
    return classes.join(" ");
  }

  function sameCheckpoint(left, right) {
    if (!left || !right) return false;
    return left.event_id === right.event_id && left.turn_id === right.turn_id && left.seq === right.seq;
  }

  function errorMessage(error) {
    if (typeof error === "string") return error;
    if (error && typeof error.message === "string") return error.message;
    if (error && typeof error.error === "string") return error.error;
    if (error && typeof error.reason === "string") return error.reason;
    return "Unknown error";
  }

  function statusSummary(nextState) {
    return model.statusSummary(nextState);
  }

  function trafficTone(nextState) {
    return model.trafficTone(nextState);
  }

  function trafficLabel(tone, nextState) {
    return model.trafficLabel(tone, nextState);
  }

  function createFallbackApi() {
    return {
      listBranches: function () {
        return Promise.resolve([{ branch_id: "br_main", label: "main" }]);
      },
      getActiveBranch: function () {
        return Promise.resolve({ branch_id: "br_main" });
      },
      listCheckpoints: function () {
        return Promise.resolve([]);
      },
      rewindPreview: function () {
        return Promise.resolve({ error: "Kernel bridge unavailable" });
      },
      rewindApply: function () {
        return Promise.resolve({ error: "Kernel bridge unavailable" });
      },
      getUsage: function () {
        return Promise.resolve({ total_tokens: 0, requests: 0, cache_hit_rate: 0, avg_latency_ms: 0 });
      },
      getState: function () {
        return Promise.resolve({ current: "preview", channel: "offline", autonomy: "gated" });
      },
      getPreferences: function () {
        return Promise.resolve({ theme: "night", railMode: "chat", contextCollapsed: false });
      },
      setPreferences: function () {
        return Promise.resolve({ theme: "night", railMode: "chat", contextCollapsed: false });
      },
      send: function () {
        return Promise.resolve({ error: "Kernel bridge unavailable" });
      },
      approve: function () {
        return Promise.resolve({ error: "Kernel bridge unavailable" });
      },
      onKernelEvent: function () {
        return function () {};
      }
    };
  }

  function createFallbackAdapter() {
    return {
      eventIcon: function () { return "-"; },
      summarizeEvent: function (event) { return (event && event.type) || "event"; },
      statusFromEvent: function () { return {}; },
      getApproval: function () { return null; }
    };
  }

  init();
})();
