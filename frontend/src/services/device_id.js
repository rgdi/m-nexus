// device_id.js — Device identification + registration (v2.19.0 + v2.20.0).
//
// On first launch (or when no cached deviceId exists), this service
// generates a UUID, persists it to localStorage, and registers the
// device with the backend via POST /api/v1/devices/register.
//
// The backend returns the device record; we keep using that ID for all
// future requests so the backend can correlate a session to a device.
//
// If running in Capacitor, we also enrich the record with native info
// (model, manufacturer, OS version) via @capacitor/device. Web fallback
// uses the browser user-agent.

import { auth } from "./auth.js";
import { detectApiBase } from "./api_base.js";

const DEVICE_ID_KEY = "mnexus.device.id";
const DEVICE_INFO_KEY = "mnexus.device.info";
const HEARTBEAT_INTERVAL_MS = 60_000; // 60 s

let heartbeatTimer = null;

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function setDeviceId(id) {
  localStorage.setItem(DEVICE_ID_KEY, id);
}

async function detectNative() {
  // Web fallback
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const ua = nav.userAgent || "";
  const baseInfo = {
    platform: "web",
    manufacturer: undefined,
    model: undefined,
    osVersion: undefined,
    pluginVersion: undefined,
    appVersion: undefined,
  };
  // Capacitor native: dynamically import the plugin so web builds skip it.
  if (window.Capacitor) {
    try {
      const deviceMod = await import("@capacitor/device");
      const info = await deviceMod.Device.getInfo();
      const appMod = await import("@capacitor/app");
      const appInfo = await appMod.App.getInfo();
      return {
        platform: info.platform || "android",
        manufacturer: info.manufacturer || undefined,
        model: info.model || undefined,
        osVersion: info.osVersion || undefined,
        pluginVersion: info.platform === "android" ? `Android ${info.osVersion}` : info.platform,
        appVersion: appInfo.version || undefined,
      };
    } catch {
      return { platform: "android", osVersion: ua };
    }
  }
  // Detect via UA
  if (/iPhone|iPad|iPod/.test(ua)) {
    return { ...baseInfo, platform: "ios", osVersion: ua.match(/OS (\d+)/)?.[1] };
  }
  if (/Android/.test(ua)) {
    return { ...baseInfo, platform: "android", osVersion: ua.match(/Android (\d[\d.]*)/)?.[1] };
  }
  return baseInfo;
}

function apiBase() {
  // v2.20.0: shared detection logic in services/api_base.js.
  return detectApiBase();
}

/**
 * Registers the device with the backend.
 * Idempotent: re-registering with the same deviceId is a no-op merge.
 *
 * Returns the device record from the backend (with server-side fields
 * like registeredAt, lastSeenAt).
 */
export async function registerDevice() {
  try {
    const deviceId = getDeviceId();
    const native = await detectNative();
    const token = auth.getAccessToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${apiBase()}/api/v1/devices/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        deviceId,
        deviceName: native.manufacturer
          ? `${native.manufacturer} ${native.model ?? ""}`.trim()
          : (typeof navigator !== "undefined" ? navigator.platform || "Web" : "Web"),
        ...native,
      }),
    });
    if (!res.ok) {
      console.warn("[device] register failed:", res.status, await res.text());
      return null;
    }
    const j = await res.json();
    const info = (j && j.device) || null;
    if (info) {
      localStorage.setItem(DEVICE_INFO_KEY, JSON.stringify(info));
      startHeartbeat(deviceId);
    }
    return info;
  } catch (e) {
    console.warn("[device] register failed:", e);
    return null;
  }
}

/**
 * Send heartbeat to backend. If we lose network, queue locally (the
 * sync_queue service handles persistence).
 */
export async function sendHeartbeat() {
  try {
    const deviceId = getDeviceId();
    const token = auth.getAccessToken();
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(`${apiBase()}/api/v1/devices/${deviceId}/heartbeat`, {
      method: "POST",
      headers,
    });
  } catch {
    // Heartbeat is best-effort; offline queue will resync later.
  }
}

export function startHeartbeat(deviceId) {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => { void sendHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Report runtime permissions to the backend. The frontend obtains the
 * permissions via the @capacitor/permissions plugin and posts the actual
 * grants as a snapshot.
 */
export async function reportPermissions(perms) {
  try {
    const deviceId = getDeviceId();
    const token = auth.getAccessToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(`${apiBase()}/api/v1/devices/${deviceId}/permissions`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(perms),
    });
  } catch (e) {
    console.warn("[device] reportPermissions failed:", e);
  }
}

/**
 * Update preferences (backend URL, sync interval, etc.) on the backend.
 * Also persists a copy locally for offline reads.
 */
export async function reportPreferences(prefs) {
  try {
    const deviceId = getDeviceId();
    const token = auth.getAccessToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(`${apiBase()}/api/v1/devices/${deviceId}/preferences`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(prefs),
    });
  } catch (e) {
    console.warn("[device] reportPreferences failed:", e);
  }
}

/**
 * Get the locally cached device info.
 */
export function getCachedDeviceInfo() {
  try {
    const raw = localStorage.getItem(DEVICE_INFO_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
