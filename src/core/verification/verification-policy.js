const VERIFY_MODES = new Set(["auto", "detect", "run", "off"]);

export function createVerificationPolicy({ verifyMode = "auto", testArgv = null } = {}) {
  if (!VERIFY_MODES.has(verifyMode)) {
    throw new Error(`unknown verifyMode: ${verifyMode}`);
  }
  const explicitArgv = normalizeTestArgv(testArgv);

  function plan({ autonomy = "gated", hasEditResults = false } = {}) {
    if (!hasEditResults) {
      return { shouldVerify: false, reason: "no edit results", mode: "skip" };
    }
    if (verifyMode === "off") {
      return { shouldVerify: false, reason: "verification disabled", mode: "off" };
    }
    if (verifyMode === "detect") {
      return { shouldVerify: true, testParams: { detect: true }, mode: "detect" };
    }
    if (verifyMode === "run") {
      return { shouldVerify: true, testParams: runParams(explicitArgv), mode: "run" };
    }
    if (autonomy === "supervised") {
      return { shouldVerify: true, testParams: { detect: true }, mode: "detect" };
    }
    return { shouldVerify: true, testParams: runParams(explicitArgv), mode: "run" };
  }

  return { plan };
}

function runParams(argv) {
  return argv ? { detect: false, argv } : { detect: false };
}

function normalizeTestArgv(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("testArgv must be an array of strings");
  }
  return [...value];
}
