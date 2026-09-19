// notif_capture.js — v2.21.0 + v2.21.1
//
// Wires the native notification listener (Android only) to the
// backend's POST /api/v1/notifications/ingest endpoint.
//
// Lifecycle:
//   1. installNotificationCapture() called from main.js (web no-op).
//   2. If Capacitor detected, every pollIntervalMs:
//      - query isNotificationListenerGranted()
//      - if granted, drain getPendingNotifications()
//      - POST in batches of batchSize (default 20) to /notifications/ingest
//      - on success, native queue is already drained, so we drop JS copy
//   3. On POST failure (network, 5xx, or any non-2xx that's not 401),
//      persist the failed batch to IndexedDB (mnexus-notif-failures).
//      Replayed at startup and on 'online' events.
//
// v2.21.1 additions:
//   - Failed batches persisted to IndexedDB (mnexus-notif-failures DB)
//   - Replayed on online event + once at startup (after 2s warmup)
//   - Bounded queue size (max 200 entries) — older entries are dropped
//     when the cap is hit, with a console warning
//   - Per-app filter list (allowedPackages in localStorage) — when set,
//     only notifications from those packages are forwarded

import { detectApiBase } from "./api_base.js";
import { getDeviceId } from "./device_id.js";
import {
  isNotificationListenerGranted,
  getPendingNotifications,
} from "./native_intents.js";

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 20;
const FAIL_DB = "mnexus-notif-failures";
const FAIL_STORE = "queue";
const FAIL_MAX = 200;

const FILTER_KEY = "mnexus.notifCapture.allowedPackages";

/**
 * Install the polling loop. Returns an object with stop() for cleanup.
 *
 * @param {Object} [opts]
 * @param {number} [opts.pollIntervalMs] - override polling interval (tests)
 * @param {number} [opts.batchSize] - override batch size (tests)
 * @returns {{ stop: () => void }}
 */
export function installNotificationCapture(opts = {}) {
  if (typeof window === "undefined") return { stop: () => {} };
  if (installNotificationCapture._installed) return installNotificationCapture._installed;
  const pollIntervalMs = opts.pollIntervalMs || POLL_INTERVAL_MS;
  const batchSize = opts.batchSize || BATCH_SIZE;

  let timer = null;
  let running = false;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    installNotificationCapture._installed = null;
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const status = await isNotificationListenerGranted();
      if (!status.granted) return;
      // Even if not connected yet, the native queue may have items from
      // a previous bind that we should drain.
      const drained = await getPendingNotifications();
      const allItems = drained.notifications || [];
      if (allItems.length === 0) {
        // Still try to drain any persisted failures from previous sessions.
        await replayFailures();
        return;
      }
      // v2.21.1: apply per-app filter (if any).
      const items = applyPackageFilter(allItems);
      if (items.length === 0) return; // everything was filtered out
      await postBatch(items, batchSize);
    } catch (e) {
      // Best-effort. Don't spam logs — the user can see the queue size
      // in android_settings.js.
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, pollIntervalMs);
  // Run once at install (don't wait 30s for first poll). Also replay any
  // persisted failures from previous sessions.
  setTimeout(async () => {
    await replayFailures();
    tick();
  }, 2000);

  // v2.21.1: also attempt to replay failures on 'online' events.
  if (typeof window !== "undefined") {
    const onOnline = () => { replayFailures().catch(() => {}); };
    window.addEventListener("online", onOnline);
    stop._removeOnline = () => window.removeEventListener("online", onOnline);
  }

  installNotificationCapture._installed = { stop };
  return installNotificationCapture._installed;
}

async function postBatch(items, batchSize) {
  const apiBase = detectApiBase();
  const deviceId = getDeviceId();
  if (!deviceId) return;
  // Split into chunks so the backend never gets a 10MB payload.
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    try {
      const authToken = readToken();
      const resp = await fetch(apiBase + "/api/v1/notifications/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
          "x-mnexus-device-id": deviceId,
        },
        body: JSON.stringify({ notifications: slice }),
      });
      if (!resp.ok && resp.status !== 401) {
        // 401: auth expired, drop. Other errors: persist for replay.
        await persistFailure(slice, resp.status);
      }
    } catch (e) {
      // Network error: persist the batch for later replay.
      await persistFailure(slice, 0);
    }
  }
}

function readToken() {
  try {
    const auth = localStorage.getItem("mnexus.auth.v1");
    if (!auth) return null;
    const parsed = JSON.parse(auth);
    return parsed.accessToken || parsed.token || null;
  } catch {
    return null;
  }
}

/**
 * v2.21.1: per-app filter. Reads mnexus.notifCapture.allowedPackages
 * from localStorage; if the array is non-empty, only notifications
 * whose packageName is in the list are forwarded. An empty array (the
 * default) means "no filter — capture everything".
 */
function applyPackageFilter(items) {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return items;
    const allowed = JSON.parse(raw);
    if (!Array.isArray(allowed) || allowed.length === 0) return items;
    return items.filter((n) => allowed.includes(n && n.packageName));
  } catch {
    return items;
  }
}

/**
 * v2.21.1: get/set the per-app filter list.
 *
 *   getAllowedPackages(): string[]  (empty = no filter)
 *   setAllowedPackages(packages: string[]): void
 */
export function getAllowedPackages() {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function setAllowedPackages(packages) {
  if (!Array.isArray(packages)) return;
  const cleaned = Array.from(new Set(packages.filter((p) => typeof p === "string" && p.length > 0)));
  localStorage.setItem(FILTER_KEY, JSON.stringify(cleaned));
}

/**
 * v2.21.1: persist a failed batch to IndexedDB so it can be replayed
 * later. The queue is capped at FAIL_MAX entries — older ones are
 * dropped (with a warning) so a long offline period doesn't OOM us.
 */
async function persistFailure(batch, statusCode) {
  if (!Array.isArray(batch) || batch.length === 0) return;
  try {
    await enqueueFailures(batch, statusCode);
  } catch (e) {
    console.warn("[notif_capture] persistFailure failed:", e);
  }
}

function openFailDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IDB"));
    const req = indexedDB.open(FAIL_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FAIL_STORE)) {
        db.createObjectStore(FAIL_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueFailures(batch, statusCode) {
  const db = await openFailDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FAIL_STORE, "readwrite");
    const store = tx.objectStore(FAIL_STORE);
    // Cap the queue. If we already have FAIL_MAX items, drop oldest.
    const countReq = store.count();
    countReq.onsuccess = () => {
      const have = countReq.result;
      const room = Math.max(0, FAIL_MAX - have);
      if (room <= 0) {
        // Drop oldest to make room.
        const c = store.openCursor();
        c.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (cursor) {
            cursor.delete();
            // After deleting 1, check room again.
            const countReq2 = store.count();
            countReq2.onsuccess = () => {
              const stillHave = countReq2.result;
              if (stillHave < FAIL_MAX - 1) {
                addEntries(store, batch, statusCode);
              } else {
                console.warn("[notif_capture] failure queue full, dropped batch");
              }
            };
          } else {
            addEntries(store, batch, statusCode);
          }
        };
      } else if (room < batch.length) {
        addEntries(store, batch.slice(0, room), statusCode);
        console.warn("[notif_capture] failure queue partial, dropped " + (batch.length - room));
      } else {
        addEntries(store, batch, statusCode);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

function addEntries(store, batch, statusCode) {
  for (const item of batch) {
    store.add({
      item,
      enqueuedAt: Date.now(),
      statusCode,
      retries: 0,
    });
  }
}

/** Test-only: drain the failure queue. */
export async function _peekFailures(limit = 100) {
  const db = await openFailDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAIL_STORE, "readonly");
    const store = tx.objectStore(FAIL_STORE);
    const req = store.getAll();
    req.onsuccess = () => { db.close(); resolve((req.result || []).slice(0, limit)); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Test-only: clear the failure queue. */
export async function _clearFailures() {
  const db = await openFailDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAIL_STORE, "readwrite");
    const store = tx.objectStore(FAIL_STORE);
    const req = store.clear();
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * v2.21.1: replay all persisted failures. Each entry is re-POSTed;
 * on success it's removed, on failure its retry counter bumps.
 *
 * The native queue might be draining at the same time. That's fine —
 * the backend dedupes by (deviceId + key) so a notification POSTed
 * twice only creates one event.
 */
let _replaying = false;
export async function replayFailures() {
  if (typeof window === "undefined") return;
  if (_replaying) return;
  _replaying = true;
  try {
    const apiBase = detectApiBase();
    const deviceId = getDeviceId();
    if (!deviceId) return;
    const failures = await _peekFailures(FAIL_MAX);
    if (failures.length === 0) return;
    const authToken = readToken();
    // Group by statusCode so we batch effectively.
    for (const f of failures) {
      if (f.retries >= 10) {
        // Give up — too many retries, drop it.
        await deleteFailures([f.id]);
        continue;
      }
      try {
        const resp = await fetch(apiBase + "/api/v1/notifications/ingest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
            "x-mnexus-device-id": deviceId,
          },
          body: JSON.stringify({ notifications: [f.item] }),
        });
        if (resp.ok || resp.status === 401) {
          await deleteFailures([f.id]);
        } else {
          await bumpFailureRetries(f.id);
        }
      } catch {
        await bumpFailureRetries(f.id);
      }
    }
  } catch (e) {
    console.warn("[notif_capture] replayFailures failed:", e);
  } finally {
    _replaying = false;
  }
}

async function deleteFailures(ids) {
  const db = await openFailDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAIL_STORE, "readwrite");
    const store = tx.objectStore(FAIL_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function bumpFailureRetries(id) {
  const db = await openFailDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAIL_STORE, "readwrite");
    const store = tx.objectStore(FAIL_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const v = req.result;
      if (v) {
        v.retries = (v.retries || 0) + 1;
        v.lastRetryAt = Date.now();
        store.put(v);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
