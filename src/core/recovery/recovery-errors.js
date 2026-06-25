export function recoveryError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = sanitizeDetails(details);
  return error;
}

export function sanitizeDetails(details = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (key.toLowerCase().includes("content") || key.toLowerCase().includes("resume")) continue;
    safe[key] = value;
  }
  return safe;
}
