export function decideRepair(verification) {
  if (!verification || verification.status === "skipped" || verification.status === "passed") {
    return { decision: "none", reason: "verification did not require repair" };
  }
  if (verification.status === "approval_required") {
    return { decision: "stop", reason: "verification requires approval" };
  }
  if (verification.status === "failed" || verification.status === "error") {
    return { decision: "repair", reason: "verification failed" };
  }
  return { decision: "stop", reason: `unhandled verification status: ${verification.status}` };
}
