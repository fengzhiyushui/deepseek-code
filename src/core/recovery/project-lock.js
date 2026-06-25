import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { atomicReadJson, atomicWriteJson, safeRecoverySegment } from "./atomic-file.js";
import { createRecoveryFaults } from "./recovery-faults.js";

const SAME_HOST_STALE_AFTER_MS = 10_000;
const CROSS_HOST_STALE_AFTER_MS = 30_000;
const OWNER_UPDATE_GATE_DIR = ".owner-update-gate";
const OWNER_UPDATE_MUTEX_METADATA_FILE = "owner-update.json";
const OWNER_UPDATE_MUTEX_RETRY_MS = 10;
const OWNER_UPDATE_MUTEX_TIMEOUT_MS = 10_000;
const OWNER_FILE = "owner.json";
const LOCK_DIR_PREFIX = ".lock";
const LOCK_CLEANUP_PREFIX = ".lock-cleanup-";
const TAKEOVER_REQUEST_PREFIX = "takeover-";
const TAKEOVER_REQUEST_SUFFIX = ".json";
const TAKEOVER_POLL_AFTER_MS = 1_000;

export async function acquireProjectLock(options) {
  const {
    root,
    surface,
    sessionId,
    interactive = false,
    takeover = null,
    now = () => new Date(),
    pid = process.pid,
    host = hostname(),
    faults = createRecoveryFaults()
  } = options;

  void interactive;

  const lockDir = path.join(root, ".deepseek-code", "v2", ".lock");
  const lockBaseDir = path.dirname(lockDir);
  const ownerPath = path.join(lockDir, OWNER_FILE);

  await mkdir(lockBaseDir, { recursive: true });

  if (takeover === "request") {
    return await requestProjectLockTakeover({
      root,
      now,
      pid,
      host,
      faults
    });
  }

  return await withOwnerUpdateMutex(lockBaseDir, { now, pid, host }, async () => {
    const ownerRead = await readOwnerForAcquire(ownerPath);
    if (!ownerRead.ok) {
      const lockExists = await pathExists(lockDir);
      if (!lockExists) {
        return await publishInitialOwnerLock({
          lockBaseDir,
          lockDir,
          ownerPath,
          epoch: 1,
          surface,
          sessionId,
          pid,
          host,
          now,
          faults
        });
      }

      if (takeover !== "force") {
        throw recoveryError(
          "RECOVERY_LOCK_CORRUPT",
          "recovery project lock is corrupt",
          { owner: null, cause: ownerRead.error }
        );
      }
    }

    const oldOwner = ownerRead.ok ? ownerRead.owner : null;
    const stale = oldOwner === null ? true : isOwnerStale(oldOwner, { host, now });

    if (takeover !== "force" && !stale) {
      throw recoveryError(
        "RECOVERY_LOCK_HELD",
        "project is already locked",
        { owner: safeOwnerMetadata(oldOwner) }
      );
    }

    const oldEpoch = Number.isInteger(oldOwner?.epoch) ? oldOwner.epoch : 0;
    return await writeAndVerifyOwner({
      lockDir,
      ownerPath,
      epoch: oldEpoch + 1,
      surface,
      sessionId,
      pid,
      host,
      now,
      faults
    });
  });
}

export async function requestProjectLockTakeover(options) {
  const {
    root,
    requesterToken = randomUUID(),
    requestId = randomUUID(),
    requestedAt,
    now = () => new Date(),
    host = hostname(),
    pid = process.pid,
    faults = createRecoveryFaults()
  } = options;

  const lockDir = path.join(root, ".deepseek-code", "v2", ".lock");
  const lockBaseDir = path.dirname(lockDir);
  const ownerPath = path.join(lockDir, OWNER_FILE);
  const initialOwnerRead = await readOwnerForAcquire(ownerPath);

  await mkdir(lockBaseDir, { recursive: true });
  await faults.maybe("before-takeover-request-mutex");

  return await withOwnerUpdateMutex(lockBaseDir, { now, pid, host }, async () => {
    await faults.maybe("before-takeover-request-owner-reread");
    const currentOwnerRead = await readOwnerForAcquire(ownerPath);
    if (!currentOwnerRead.ok) {
      if (!(await pathExists(lockDir))) {
        throw recoveryError(
          "RECOVERY_LOCK_NOT_HELD",
          "project lock is no longer held",
          { owner: safeOwnerMetadata(initialOwnerRead.owner), cause: currentOwnerRead.error }
        );
      }
      throw recoveryError(
        "RECOVERY_LOCK_CORRUPT",
        "recovery project lock is corrupt",
        { owner: null, cause: currentOwnerRead.error }
      );
    }

    if (initialOwnerRead.ok && !sameOwnerIdentity(initialOwnerRead.owner, currentOwnerRead.owner)) {
      throw recoveryError(
        "RECOVERY_LOCK_CHANGED",
        "project lock owner changed before takeover request",
        {
          owner: safeOwnerMetadata(currentOwnerRead.owner),
          previous_owner: safeOwnerMetadata(initialOwnerRead.owner)
        }
      );
    }

    const request = await createTakeoverRequest({
      lockDir,
      now,
      faults,
      owner: currentOwnerRead.owner,
      requesterToken,
      requestedAt: requestedAt ?? timestampIso(now),
      requestId
    });

    return {
      status: "requested",
      request,
      owner: safeOwnerMetadata(currentOwnerRead.owner),
      owner_stale: isOwnerStale(currentOwnerRead.owner, { host, now }),
      poll_after_ms: TAKEOVER_POLL_AFTER_MS
    };
  });
}

async function publishInitialOwnerLock({ lockBaseDir, lockDir, ownerPath, epoch, surface, sessionId, pid, host, now, faults }) {
  const tempLockDir = path.join(lockBaseDir, `${LOCK_DIR_PREFIX}-publish-${process.pid}-${randomUUID()}`);
  const tempOwnerPath = path.join(tempLockDir, OWNER_FILE);
  const owner = createOwner({ epoch, surface, sessionId, pid, host, now });

  try {
    await mkdir(tempLockDir, { recursive: false });
    await writeOwner(tempOwnerPath, owner);

    const tempReloaded = await readOwnerForOwnership(tempOwnerPath);
    if (tempReloaded.token !== owner.token || tempReloaded.epoch !== owner.epoch) {
      throw lockNotOwnedError();
    }

    await rename(tempLockDir, lockDir);

    const reloaded = await readOwnerForOwnership(ownerPath);
    if (reloaded.token !== owner.token || reloaded.epoch !== owner.epoch) {
      throw lockNotOwnedError();
    }

    await faults.maybe("after-lock-owner-write");

    return createLock({ lockDir, ownerPath, owner, now, faults });
  } catch (error) {
    await rm(tempLockDir, { recursive: true, force: true });
    throw error;
  }
}

async function writeAndVerifyOwner({ lockDir, ownerPath, epoch, surface, sessionId, pid, host, now, faults }) {
  const owner = createOwner({ epoch, surface, sessionId, pid, host, now });
  await writeOwner(ownerPath, owner);
  await removeTakeoverRequestFiles(lockDir);

  const reloaded = await readOwnerForOwnership(ownerPath);
  if (reloaded.token !== owner.token || reloaded.epoch !== owner.epoch) {
    throw lockNotOwnedError();
  }

  await faults.maybe("after-lock-owner-write");

  return createLock({ lockDir, ownerPath, owner, now, faults });
}

function createOwner({ epoch, surface, sessionId, pid, host, now }) {
  const owner = {
    epoch,
    token: randomUUID(),
    pid,
    host,
    surface,
    session_id: sessionId,
    heartbeat_at: timestampIso(now),
    phase: "idle",
    released_at: null
  };
  if (!isValidOwner(owner)) {
    throw recoveryError("RECOVERY_LOCK_INVALID_OWNER", "invalid lock owner metadata");
  }
  return owner;
}

function createLock({ lockDir, ownerPath, owner, now, faults }) {
  const lockBaseDir = path.dirname(lockDir);
  const state = { owner };

  return {
    get owner() {
      return state.owner;
    },

    get epoch() {
      return state.owner.epoch;
    },

    async assertOwner() {
      return await readOwnedCurrent(ownerPath, state.owner);
    },

    async heartbeat() {
      return await withOwnerUpdateMutex(lockBaseDir, { now, pid: state.owner.pid, host: state.owner.host }, async () => {
        const current = await readOwnedCurrent(ownerPath, state.owner);
        const updated = {
          ...current,
          heartbeat_at: timestampIso(now)
        };
        await writeOwner(ownerPath, updated);
        state.owner = updated;
        await faults.maybe("after-lock-owner-write");
        return updated;
      });
    },

    async release() {
      await withOwnerUpdateMutex(lockBaseDir, { now, pid: state.owner.pid, host: state.owner.host }, async () => {
        if (isOwnerReleased(state.owner)) {
          throw lockNotOwnedError();
        }
        const current = await readOwnedCurrent(ownerPath, state.owner);
        const released = {
          ...current,
          released_at: timestampIso(now)
        };
        state.owner = released;
        const cleanupLockDir = path.join(lockBaseDir, `${LOCK_CLEANUP_PREFIX}${process.pid}-${randomUUID()}`);
        await writeOwner(ownerPath, released);
        await faults.maybe("after-lock-owner-write");
        await rename(lockDir, cleanupLockDir);
        await rm(cleanupLockDir, { recursive: true, force: true });
      });
    },

    async requestTakeover(request = {}) {
      return await withOwnerUpdateMutex(lockBaseDir, { now, pid: state.owner.pid, host: state.owner.host }, async () => {
        const current = await readOwnedCurrent(ownerPath, state.owner);
        return await createTakeoverRequest({
          lockDir,
          now,
          faults,
          owner: current,
          requesterToken: request.requesterToken,
          requestedAt: request.requestedAt,
          requestId: request.requestId
        });
      });
    },


    async readWinningTakeoverRequest() {
      const current = await readOwnedCurrent(ownerPath, state.owner);
      return await readWinningTakeoverRequest(lockDir, current);
    }
  };
}

async function withOwnerUpdateMutex(lockBaseDir, context, operation) {
  const gatePath = path.join(lockBaseDir, OWNER_UPDATE_GATE_DIR);
  const cleanupGatePath = path.join(lockBaseDir, `${OWNER_UPDATE_GATE_DIR}-cleanup`);
  const startedAt = Date.now();
  const metadataContext = normalizeMutexContext(context);
  const holderToken = randomUUID();
  let acquired = false;

  while (!acquired) {
    await waitForOwnerUpdateCleanupGate(cleanupGatePath, metadataContext, startedAt);
    try {
      await mkdir(gatePath, { recursive: false });
      try {
        await writeOwnerUpdateMutexMetadata(gatePath, {
          token: holderToken,
          pid: metadataContext.pid,
          host: metadataContext.host,
          created_at: timestampIso(metadataContext.now)
        });
      } catch (error) {
        await removeOwnerUpdateMutex(gatePath);
        throw error;
      }
      acquired = true;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleOwnerUpdateMutex(gatePath, cleanupGatePath, metadataContext, startedAt)) {
        continue;
      }
      if (Date.now() - startedAt >= OWNER_UPDATE_MUTEX_TIMEOUT_MS) {
        throw recoveryError("RECOVERY_LOCK_BUSY", "timed out waiting for owner update lock");
      }
      await delay(OWNER_UPDATE_MUTEX_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await removeOwnerUpdateMutexIfHeld(gatePath, holderToken);
  }
}

function normalizeMutexContext(context) {
  return {
    now: context?.now ?? (() => new Date()),
    pid: context?.pid ?? process.pid,
    host: context?.host ?? hostname()
  };
}

async function waitForOwnerUpdateCleanupGate(cleanupGatePath, context, startedAt) {
  while (await pathExists(cleanupGatePath)) {
    if (await removeStaleOwnerUpdateCleanupGate(cleanupGatePath, context)) {
      continue;
    }
    if (Date.now() - startedAt >= OWNER_UPDATE_MUTEX_TIMEOUT_MS) {
      throw recoveryError("RECOVERY_LOCK_BUSY", "timed out waiting for owner update cleanup lock");
    }
    await delay(OWNER_UPDATE_MUTEX_RETRY_MS);
  }
}

async function writeOwnerUpdateMutexMetadata(mutexPath, metadata) {
  await writeFile(
    path.join(mutexPath, OWNER_UPDATE_MUTEX_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`
  );
}

async function readOwnerUpdateMutexMetadata(mutexPath) {
  const metadataPath = path.join(mutexPath, OWNER_UPDATE_MUTEX_METADATA_FILE);
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (!isValidOwnerUpdateMutexMetadata(metadata)) {
      return { ok: false, metadata: null };
    }
    return { ok: true, metadata };
  } catch {
    return { ok: false, metadata: null };
  }
}

function isValidOwnerUpdateMutexMetadata(metadata) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      isNonEmptyString(metadata.token) &&
      Number.isInteger(metadata.pid) &&
      metadata.pid > 0 &&
      isNonEmptyString(metadata.host) &&
      isFiniteTimestamp(metadata.created_at)
  );
}

async function removeStaleOwnerUpdateMutex(gatePath, cleanupGatePath, context, startedAt) {
  const firstRead = await readOwnerUpdateMutexMetadata(gatePath);
  if (!(await isOwnerUpdateMutexStale(gatePath, firstRead, context))) {
    return false;
  }

  const cleanupToken = await acquireOwnerUpdateCleanupGate(cleanupGatePath, context, startedAt);
  if (cleanupToken === null) {
    return false;
  }

  try {
    const secondRead = await readOwnerUpdateMutexMetadata(gatePath);
    if (!sameOwnerUpdateMutexRead(firstRead, secondRead)) {
      return false;
    }
    if (!(await isOwnerUpdateMutexStale(gatePath, secondRead, context))) {
      return false;
    }
    await removeOwnerUpdateMutex(gatePath);
    return true;
  } finally {
    await removeOwnerUpdateMutexIfHeld(cleanupGatePath, cleanupToken);
  }
}

async function acquireOwnerUpdateCleanupGate(cleanupGatePath, context, startedAt) {
  const holderToken = randomUUID();
  while (true) {
    try {
      await mkdir(cleanupGatePath, { recursive: false });
      try {
        await writeOwnerUpdateMutexMetadata(cleanupGatePath, {
          token: holderToken,
          pid: context.pid,
          host: context.host,
          created_at: timestampIso(context.now)
        });
      } catch (error) {
        await removeOwnerUpdateMutex(cleanupGatePath);
        throw error;
      }
      return holderToken;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await removeStaleOwnerUpdateCleanupGate(cleanupGatePath, context)) {
        continue;
      }
      if (Date.now() - startedAt >= OWNER_UPDATE_MUTEX_TIMEOUT_MS) {
        throw recoveryError("RECOVERY_LOCK_BUSY", "timed out waiting for owner update cleanup lock");
      }
      await delay(OWNER_UPDATE_MUTEX_RETRY_MS);
    }
  }
}

async function isOwnerUpdateMutexStale(mutexPath, metadataRead, context) {
  if (metadataRead.ok) {
    const metadata = metadataRead.metadata;
    if (metadata.host === context.host) {
      return !isPidLive(metadata.pid);
    }

    const createdAge = timestampMs(context.now) - Date.parse(metadata.created_at);
    const normalizedAge = Number.isFinite(createdAge) ? Math.max(0, createdAge) : Infinity;
    return normalizedAge >= OWNER_UPDATE_MUTEX_TIMEOUT_MS;
  }

  const age = await ownerUpdateMutexDirectoryAgeMs(mutexPath, context.now);
  return age >= OWNER_UPDATE_MUTEX_TIMEOUT_MS;
}

function sameOwnerUpdateMutexRead(left, right) {
  if (left.ok || right.ok) {
    return left.ok === right.ok && left.metadata?.token === right.metadata?.token;
  }
  return true;
}

async function ownerUpdateMutexDirectoryAgeMs(mutexPath, now) {
  try {
    const stats = await stat(mutexPath);
    const age = timestampMs(now) - stats.mtimeMs;
    return Number.isFinite(age) ? Math.max(0, age) : Infinity;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Infinity;
    }
    throw error;
  }
}

async function removeOwnerUpdateMutexIfHeld(mutexPath, holderToken) {
  const metadataRead = await readOwnerUpdateMutexMetadata(mutexPath);
  if (!metadataRead.ok || metadataRead.metadata.token !== holderToken) {
    return;
  }
  await removeOwnerUpdateMutex(mutexPath);
}

async function removeOwnerUpdateMutex(mutexPath) {
  try {
    await rm(mutexPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup: if the mutex directory is already gone, the next
    // operation will still verify owner token/epoch before mutating.
  }
}

async function removeStaleOwnerUpdateCleanupGate(cleanupGatePath, context) {
  const metadataRead = await readOwnerUpdateMutexMetadata(cleanupGatePath);
  if (!(await isOwnerUpdateMutexStale(cleanupGatePath, metadataRead, context))) {
    return false;
  }

  if (metadataRead.ok) {
    await removeOwnerUpdateMutexIfHeld(cleanupGatePath, metadataRead.metadata.token);
    return true;
  }

  await removeOwnerUpdateMutex(cleanupGatePath);
  return true;
}

async function readOwnedCurrent(ownerPath, expectedOwner) {
  if (isOwnerReleased(expectedOwner)) {
    throw lockNotOwnedError();
  }
  const current = await readOwnerForOwnership(ownerPath);
  if (current.token !== expectedOwner.token || current.epoch !== expectedOwner.epoch || isOwnerReleased(current)) {
    throw lockNotOwnedError();
  }
  return current;
}

async function writeOwner(ownerPath, owner) {
  await atomicWriteJson(ownerPath, owner);
}

async function readOwnerForAcquire(ownerPath) {
  try {
    const owner = await atomicReadJson(ownerPath);
    if (!isValidOwner(owner)) {
      return { ok: false, error: new Error("malformed owner.json") };
    }
    return { ok: true, owner };
  } catch (error) {
    return { ok: false, error };
  }
}

async function readOwnerForOwnership(ownerPath) {
  try {
    const owner = await atomicReadJson(ownerPath);
    if (!isValidOwner(owner)) {
      throw new Error("malformed owner.json");
    }
    return owner;
  } catch {
    throw lockNotOwnedError();
  }
}

function sameOwnerIdentity(left, right) {
  return left?.token === right?.token && left?.epoch === right?.epoch;
}

function isValidOwner(owner) {
  return Boolean(
    owner &&
      typeof owner === "object" &&
      !Array.isArray(owner) &&
      Number.isInteger(owner.epoch) &&
      owner.epoch >= 1 &&
      isNonEmptyString(owner.token) &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      isNonEmptyString(owner.host) &&
      isNonEmptyString(owner.surface) &&
      isNonEmptyString(owner.session_id) &&
      isFiniteTimestamp(owner.heartbeat_at) &&
      isNonEmptyString(owner.phase) &&
      (owner.released_at === null || isFiniteTimestamp(owner.released_at))
  );
}

function isOwnerStale(owner, { host, now }) {
  if (owner?.released_at !== null && owner?.released_at !== undefined) {
    return true;
  }

  const heartbeatAge = timestampMs(now) - ownerHeartbeatMs(owner);
  const normalizedAge = Number.isFinite(heartbeatAge) ? Math.max(0, heartbeatAge) : Infinity;

  if (owner?.host === host) {
    if (!isPidLive(owner?.pid)) {
      return true;
    }
    return normalizedAge >= SAME_HOST_STALE_AFTER_MS;
  }

  return normalizedAge >= CROSS_HOST_STALE_AFTER_MS;
}

function isPidLive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH" && error?.code !== "EINVAL";
  }
}

async function createTakeoverRequest({
  lockDir,
  now,
  faults,
  owner,
  requesterToken = randomUUID(),
  requestedAt = timestampIso(now),
  requestId = randomUUID()
}) {
  const request_id = safeRecoverySegment(requestId);
  const request = {
    request_id,
    requester_token: requesterToken,
    requested_at: normalizeTimestampIso(requestedAt),
    owner_token: owner?.token,
    owner_epoch: owner?.epoch
  };
  if (!isValidTakeoverRequest(request, `${TAKEOVER_REQUEST_PREFIX}${request_id}${TAKEOVER_REQUEST_SUFFIX}`, owner)) {
    throw new Error("invalid takeover request");
  }
  const requestPath = takeoverRequestPath(lockDir, request_id);

  await atomicWriteJson(requestPath, request);
  await faults.maybe("after-takeover-request-write");
  return request;
}

async function removeTakeoverRequestFiles(lockDir) {
  let entries;
  try {
    entries = await readdir(lockDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isTakeoverRequestFile(entry.name))
      .map((entry) => rm(path.join(lockDir, entry.name), { force: true }))
  );
}

async function readWinningTakeoverRequest(lockDir, owner) {
  let entries;
  try {
    entries = await readdir(lockDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const requests = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isTakeoverRequestFile(entry.name)) {
      continue;
    }

    try {
      const request = await atomicReadJson(path.join(lockDir, entry.name));
      if (isValidTakeoverRequest(request, entry.name, owner)) {
        requests.push(request);
      }
    } catch {
      // Ignore malformed takeover requests; they cannot safely win.
    }
  }

  requests.sort((left, right) => {
    const leftTime = Date.parse(left.requested_at);
    const rightTime = Date.parse(right.requested_at);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return String(left.request_id).localeCompare(String(right.request_id));
  });

  return requests[0] ?? null;
}

function takeoverRequestPath(lockDir, requestId) {
  return path.join(lockDir, `${TAKEOVER_REQUEST_PREFIX}${requestId}${TAKEOVER_REQUEST_SUFFIX}`);
}

function isTakeoverRequestFile(name) {
  return name.startsWith(TAKEOVER_REQUEST_PREFIX) && name.endsWith(TAKEOVER_REQUEST_SUFFIX);
}

function isValidTakeoverRequest(request, fileName, owner) {
  if (!request || typeof request !== "object" || Array.isArray(request) || !isValidOwner(owner)) {
    return false;
  }

  const expectedRequestId = fileName.slice(
    TAKEOVER_REQUEST_PREFIX.length,
    fileName.length - TAKEOVER_REQUEST_SUFFIX.length
  );

  try {
    safeRecoverySegment(expectedRequestId);
    safeRecoverySegment(request.request_id);
  } catch {
    return false;
  }

  return Boolean(
    request.request_id === expectedRequestId &&
      isNonEmptyString(request.requester_token) &&
      isFiniteTimestamp(request.requested_at) &&
      request.owner_token === owner.token &&
      request.owner_epoch === owner.epoch
  );
}

function isOwnerReleased(owner) {
  return owner?.released_at !== null && owner?.released_at !== undefined;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function ownerHeartbeatMs(owner) {
  return Date.parse(owner?.heartbeat_at);
}

function timestampMs(now) {
  const value = now();
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value.valueOf === "function") {
    const numeric = value.valueOf();
    if (typeof numeric === "number") {
      return numeric;
    }
  }
  return Date.parse(value);
}

function timestampIso(now) {
  return normalizeTimestampIso(now());
}

function normalizeTimestampIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    if (!isFiniteTimestamp(value)) {
      throw new Error(`invalid timestamp: ${value}`);
    }
    return value;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

function isFiniteTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function safeOwnerMetadata(owner) {
  if (owner === null || typeof owner !== "object") {
    return null;
  }

  return {
    epoch: owner.epoch,
    pid: owner.pid,
    host: owner.host,
    surface: owner.surface,
    session_id: owner.session_id,
    heartbeat_at: owner.heartbeat_at,
    phase: owner.phase,
    released_at: owner.released_at
  };
}

function recoveryError(code, message, properties = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, properties);
  return error;
}

function lockNotOwnedError() {
  return recoveryError("RECOVERY_LOCK_NOT_OWNED", "lock not owned");
}
