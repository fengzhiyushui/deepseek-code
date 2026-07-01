// gui/src/state/settings-schema.js — pure schema + coercion for the Settings view.
// Groups mirror the real config sections (config.js). Because configureProject() does a
// shallow merge then re-normalizes, the Settings view edits a full-config draft and saves
// it whole; these helpers coerce field values and read/write nested paths immutably.
// Pure — node:test-covered. i18n happens in the component via label keys.

export const SETTINGS_GROUPS = [
  { id: "general", labelKey: "settings.general", kind: "prefs" },
  { id: "model", labelKey: "settings.model", kind: "model" },       // API list + model fetch (custom UI)
  { id: "limits", labelKey: "settings.limits", kind: "config", fields: [
    { path: "limits.toolTimeoutMs", labelKey: "settings.f.toolTimeoutMs", type: "nullableInt", unit: "ms" },
    { path: "limits.modelTimeoutMs", labelKey: "settings.f.modelTimeoutMs", type: "nullableInt", unit: "ms" },
    { path: "limits.maxTurnTokens", labelKey: "settings.f.maxTurnTokens", type: "nullableInt" },
    { path: "limits.maxModelCalls", labelKey: "settings.f.maxModelCalls", type: "nullableInt" },
    { path: "limits.maxToolCallRepairs", labelKey: "settings.f.maxToolCallRepairs", type: "nullableInt" }
  ] },
  { id: "orchestration", labelKey: "settings.orchestration", kind: "config", fields: [
    { path: "orchestration.maxRounds", labelKey: "settings.f.maxRounds", type: "posInt" },
    { path: "orchestration.maxSubtasks", labelKey: "settings.f.maxSubtasks", type: "posInt" },
    { path: "orchestration.maxWorkerAttempts", labelKey: "settings.f.maxWorkerAttempts", type: "posInt" },
    { path: "orchestration.parallel.maxParallelWorkers", labelKey: "settings.f.maxParallelWorkers", type: "posInt" },
    { path: "orchestration.budget.maxModelCalls", labelKey: "settings.f.budgetMaxModelCalls", type: "nullableInt" },
    { path: "orchestration.budget.maxTokens", labelKey: "settings.f.budgetMaxTokens", type: "nullableInt" },
    { path: "orchestration.router.model.enabled", labelKey: "settings.f.routerModelEnabled", type: "bool" },
    { path: "orchestration.crossTaskLearning", labelKey: "settings.f.crossTaskLearning", type: "enum", options: ["off", "on", "gated"] }
  ] },
  { id: "context", labelKey: "settings.context", kind: "config", fields: [
    { path: "context.semantic.enabled", labelKey: "settings.f.semanticEnabled", type: "bool" },
    { path: "context.semantic.hops", labelKey: "settings.f.semanticHops", type: "posInt" },
    { path: "context.semantic.maxSymbols", labelKey: "settings.f.semanticMaxSymbols", type: "posInt" },
    { path: "context.semantic.includeMethodHints", labelKey: "settings.f.semanticMethodHints", type: "bool" }
  ] },
  { id: "experience", labelKey: "settings.experience", kind: "config", fields: [
    { path: "orchestration.experience.retrieveK", labelKey: "settings.f.experienceRetrieveK", type: "posInt" },
    { path: "orchestration.experience.cap", labelKey: "settings.f.experienceCap", type: "posInt" },
    { path: "orchestration.experience.maxLessonsPerTask", labelKey: "settings.f.experienceMaxLessons", type: "posInt" }
  ] },
  { id: "about", labelKey: "settings.about", kind: "about" }
];

export function getByPath(obj, path) {
  return String(path).split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

// Immutable deep set — returns a new object, cloning only the touched path.
export function setByPath(obj, path, value) {
  const keys = String(path).split(".");
  const root = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) };
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const child = cursor[k];
    cursor[k] = child && typeof child === "object" ? (Array.isArray(child) ? child.slice() : { ...child }) : {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
  return root;
}

// Coerce a raw form value to the field's type (matches config.js normalizers).
export function coerceField(field, raw) {
  switch (field.type) {
    case "bool":
      return Boolean(raw);
    case "enum":
      return (field.options || []).includes(raw) ? raw : (field.options || [])[0];
    case "posInt": {
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : (field.min || 1);
    }
    case "nonNegInt": {
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    }
    case "nullableInt": {
      if (raw === "" || raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
    }
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    default:
      return raw;
  }
}

// Apply one field edit to a draft config, returning a new draft.
export function applyFieldEdit(draft, field, raw) {
  return setByPath(draft || {}, field.path, coerceField(field, raw));
}

// Strip renderer-only keys before sending a config draft back to configureProject.
export function sanitizeConfigPatch(draft) {
  const out = { ...(draft || {}) };
  delete out.hasApiKey;
  return out;
}
