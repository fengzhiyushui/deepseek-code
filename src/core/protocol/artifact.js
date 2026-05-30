import { makeId } from "../../shared/id.js";

export function createArtifact({
  kind,
  path,
  hash,
  size,
  ttl = null,
  metadata = {},
  id = makeId("artifact")
}) {
  if (!kind) throw new Error("artifact kind is required");
  if (!path) throw new Error("artifact path is required");
  if (!hash) throw new Error("artifact hash is required");
  if (!Number.isFinite(size) || size < 0) throw new Error("artifact size must be a non-negative number");

  return { id, kind, path, hash, size, ttl, metadata };
}
