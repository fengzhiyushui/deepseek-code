import { randomUUID } from "node:crypto";

export function makeId(prefix) {
  if (!prefix || typeof prefix !== "string") {
    throw new Error("id prefix must be a non-empty string");
  }
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
