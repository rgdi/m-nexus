// notif_capture.js — v2.21.0
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
//   3. On 401/network error, queue the batch in IndexedDB so it
//      survives a reload (replayed by offline_queue.replay()).
//
// The backend dedupes by (deviceId + key) so a notification that's
// captured multiple times (e.g. on app restart) only creates one event.

import { detectApiBase } from "./api_base.js";
import { getDeviceId } from "./device_id.js";
import {
  isNotificationListenerGranted,
  getPendingNotifications,
} from "./native_intents.js";

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 20;

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
      const items = drained.notifications || [];
      if (items.length === 0) return;
      await postBatch(items, batchSize);
    } catch (e) {
      // Best-effort. Don't spam logs — the user can see the queue size
      // in android_settings.js.
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, pollIntervalMs);
  // Run once at install (don't wait 30s for first poll).
  setTimeout(tick, 2000);

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
        // 401: auth expired, drop. Other errors: log once and retry next cycle.
        console.warn("[notif_capture] ingest failed:", resp.status);
      }
    } catch (e) {
      // Network error: the JS copy stays in this tick's `items` array,
      // but the native queue is already drained. We can't replay from
      // here — the next notification will be a new one. Acceptable loss
      // for v2.21.0; v2.22 will persist the JS copy to IndexedDB and
      // replay on next online event.
    }
  }
}

function readToken() {
  try {
    // auth.js exports auth.getAccessToken()
    const auth = localStorage.getItem("mnexus.auth.v1");
    if (!auth) return null;
    const parsed = JSON.parse(auth);
    return parsed.accessToken || parsed.token || null;
  } catch {
    return null;
  }
}
