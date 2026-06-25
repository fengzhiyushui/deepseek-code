export function createRecoveryService({
  projectId,
  lock,
  paused,
  pausedTurnStore,
  inbox,
  appendMarker,
  resumePaused = null,
  cancelPaused = null,
  transactionJournal = null
}) {
  let latestReport = null;

  async function recoverOnStartup() {
    await lock.assertOwner();
    const recoveryId = `recovery_${Date.now()}`;
    await appendMarker("recovery:started", { recovery_id: recoveryId, project_id: projectId, lock_epoch: lock.epoch });

    const found = [];
    const done = [];
    const blocked = [];
    const next = [];

    // Scan transaction journals
    if (transactionJournal) {
      const journals = await transactionJournal.scan();
      for (const journal of journals) {
        if (journal.state === "open" || journal.state === "aborting") {
          found.push({ type: "transaction_journal", summary: `Open ${journal.kind} transaction: ${journal.tx_id}` });
          await inbox.upsert({
            id: `rec_journal_${journal.tx_id}`,
            type: "transaction_journal",
            status: "pending",
            source_id: journal.tx_id,
            summary: `Open ${journal.kind} transaction from ${journal.session_id}`,
            evidence: {
              kind: journal.kind,
              tx_id: journal.tx_id,
              session_id: journal.session_id,
              turn_id: journal.turn_id,
              paths: journal.paths?.map(p => p.path) || [],
              state: journal.state
            },
            allowed_actions: ["abort_journal", "commit_journal"],
            metadata: {
              kind: journal.kind,
              tx_id: journal.tx_id,
              session_id: journal.session_id,
              turn_id: journal.turn_id,
              state: journal.state,
              rewind_branch_state: journal.rewind_branch_state
            }
          });
          await appendMarker("recovery:transaction_journal_found", {
            tx_id: journal.tx_id,
            kind: journal.kind,
            state: journal.state,
            session_id: journal.session_id
          });
          next.push(`/recovery abort_journal rec_journal_${journal.tx_id}`);
        } else if (journal.state === "committed") {
          // Committed journals are informational only
          found.push({ type: "transaction_journal", summary: `Committed ${journal.kind} transaction: ${journal.tx_id}` });
        } else if (journal.state === "corrupt") {
          found.push({ type: "transaction_journal", summary: `Corrupt transaction journal: ${journal.tx_id}` });
          blocked.push({ type: "transaction_journal", summary: `Corrupt journal: ${journal.tx_id}`, reason: journal.error });
          await inbox.upsert({
            id: `rec_journal_${journal.tx_id}`,
            type: "blocked_recovery",
            status: "blocked",
            source_id: journal.tx_id,
            summary: `Corrupt transaction journal: ${journal.tx_id}`,
            evidence: { error: journal.error },
            allowed_actions: ["remove_journal"]
          });
        }
      }
    }

    // Scan paused sidecars
    const scanned = await paused.scan();
    for (const item of scanned) {
      if (item.status === "corrupt") {
        found.push({ type: "paused_turn", summary: `Corrupt paused sidecar: ${item.approval_id}` });
        blocked.push({ type: "paused_turn", summary: `Corrupt paused sidecar: ${item.approval_id}`, reason: item.reason });
        await inbox.upsert({
          id: `rec_pause_${item.approval_id}`,
          type: "blocked_recovery",
          status: "blocked",
          source_id: item.approval_id,
          summary: `Corrupt paused sidecar: ${item.approval_id}`,
          evidence: { sidecar_path: item.path },
          allowed_actions: ["cancel"]
        });
        await appendMarker("recovery:blocked", {
          item_id: `rec_pause_${item.approval_id}`,
          source_id: item.approval_id,
          reason: item.reason || "corrupt sidecar"
        });
      } else if (item.status === "consumed") {
        // Skip consumed sidecars silently
        continue;
      } else {
        // Valid paused record
        found.push({ type: "paused_turn", summary: `Paused approval: ${item.approval_id}` });
        pausedTurnStore.restore(item);
        await inbox.upsert({
          id: `rec_pause_${item.approval_id}`,
          type: "paused_turn",
          status: "pending",
          source_id: item.approval_id,
          summary: `Paused ${item.surface || "turn"}: ${item.approval?.summary || "approval required"}`,
          evidence: { sidecar_path: paused.baseDir },
          allowed_actions: ["resume", "cancel"],
          metadata: {
            turn_id: item.turn_id,
            autonomy: item.permission_context?.autonomy || item.turn?.autonomy,
            surface: item.surface
          }
        });
        await appendMarker("turn:rehydrated", {
          approval_id: item.approval_id,
          turn_id: item.turn_id,
          original_session_id: item.session_id,
          marker_status: "ok"
        });
        done.push({ type: "paused_turn", summary: `Rehydrated approval: ${item.approval_id}` });
        next.push(`/recovery resume rec_pause_${item.approval_id}`);
      }
    }

    latestReport = { found, done, blocked, next };
    await appendMarker("recovery:report", {
      recovery_id: recoveryId,
      found_count: found.length,
      done_count: done.length,
      blocked_count: blocked.length,
      next_actions: next
    });

    return latestReport;
  }

  async function list({ includeCleared = false } = {}) {
    const inboxItems = await inbox.list({ includeCleared });
    // Filter out resumed/cancelled items unless includeCleared is true
    const filtered = includeCleared ? inboxItems : inboxItems.filter(item =>
      item.status !== "resumed" && item.status !== "cancelled"
    );
    // Also include any in-memory paused records not yet in inbox
    const memoryPaused = pausedTurnStore.list ? pausedTurnStore.list() : [];
    const inboxIds = new Set(filtered.map(item => item.source_id));
    const memoryItems = memoryPaused
      .filter(record => !inboxIds.has(record.approval_id))
      .map(record => ({
        id: `rec_pause_${record.approval_id}`,
        type: "paused_turn",
        status: "pending",
        source_id: record.approval_id,
        summary: record.approval?.summary || "Approval paused",
        evidence: { sidecar_path: paused.baseDir },
        allowed_actions: ["resume", "cancel"],
        metadata: {
          turn_id: record.turn_id,
          autonomy: record.permission_context?.autonomy || record.turn?.autonomy || "gated",
          surface: record.surface || "unknown"
        },
        created_at: record.created_at || new Date().toISOString(),
        updated_at: record.created_at || new Date().toISOString()
      }));
    return [...filtered, ...memoryItems].sort((a, b) => {
      const byCreated = (a.created_at || "").localeCompare(b.created_at || "");
      return byCreated || a.id.localeCompare(b.id);
    });
  }

  async function resume(id, { decision = "approve" } = {}) {
    if (!id.startsWith("rec_pause_")) {
      throw new Error(`invalid resume target: ${id}`);
    }
    const approvalId = id.replace(/^rec_pause_/, "");
    if (!resumePaused) {
      throw new Error("recovery resume not wired");
    }
    const result = await resumePaused(approvalId, decision);
    // Mark as resumed in inbox
    const item = await inbox.get(id);
    if (item) {
      await inbox.mark(id, { status: "resumed" });
    }
    return { status: "resumed", item, result };
  }

  async function cancel(id) {
    if (!id.startsWith("rec_pause_")) {
      throw new Error(`invalid cancel target: ${id}`);
    }
    const approvalId = id.replace(/^rec_pause_/, "");

    // Check if this is a blocked corrupt sidecar
    const item = await inbox.get(id);
    if (item && item.type === "blocked_recovery" && item.status === "blocked") {
      // Quarantine the corrupt sidecar
      const result = await paused.quarantine(approvalId, "operator cancelled corrupt sidecar");
      await inbox.mark(id, { status: "cancelled" });
      return { status: result.status, item, result };
    }

    // Normal paused turn cancellation
    if (!cancelPaused) {
      throw new Error("recovery cancel not wired");
    }
    const result = await cancelPaused(approvalId);
    if (item) {
      await inbox.mark(id, { status: "cancelled" });
    }
    return { status: "cancelled", item, result };
  }

  async function clear(id) {
    await inbox.clear(id);
    return { status: "cleared" };
  }

  async function abortJournal(id) {
    if (!id.startsWith("rec_journal_")) {
      throw new Error(`invalid abort_journal target: ${id}`);
    }
    if (!transactionJournal) {
      throw new Error("transaction journal not wired");
    }
    const txId = id.replace(/^rec_journal_/, "");
    const item = await inbox.get(id);

    const result = await transactionJournal.abort(txId);

    if (item) {
      await inbox.mark(id, { status: "aborted" });
    }

    await appendMarker("recovery:transaction_journal_aborted", {
      tx_id: txId,
      preserved_count: result.preserved_count
    });

    return { status: "aborted", item, result };
  }

  async function commitJournal(id) {
    if (!id.startsWith("rec_journal_")) {
      throw new Error(`invalid commit_journal target: ${id}`);
    }
    if (!transactionJournal) {
      throw new Error("transaction journal not wired");
    }
    const txId = id.replace(/^rec_journal_/, "");
    const item = await inbox.get(id);

    await transactionJournal.commit(txId, { manual_commit: true });

    if (item) {
      await inbox.mark(id, { status: "committed" });
    }

    await appendMarker("recovery:transaction_journal_committed", {
      tx_id: txId
    });

    return { status: "committed", item };
  }

  function report() {
    return latestReport || { found: [], done: [], blocked: [], next: [] };
  }

  return {
    recoverOnStartup,
    list,
    resume,
    cancel,
    clear,
    abortJournal,
    commitJournal,
    report
  };
}
