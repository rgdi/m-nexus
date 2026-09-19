// v2190.test.js — v2.19.0 frontend additions:
// - device_id.js generates UUID, persists to localStorage, calls /devices/register
// - offline_queue.js uses IndexedDB, replays via /sync/replay
// - android_settings.js mounts only when window.Capacitor is present
// - api.js queues mutations offline when network fails
// - main.js registers device on boot

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.19.0 — device_id service", () => {
  it("exports getDeviceId, registerDevice, sendHeartbeat, reportPermissions, reportPreferences", () => {
    const src = readFileSync(SRC("frontend/src/services/device_id.js"), "utf-8");
    expect(src).toMatch(/export function getDeviceId/);
    expect(src).toMatch(/export async function registerDevice/);
    expect(src).toMatch(/export async function sendHeartbeat/);
    expect(src).toMatch(/export async function reportPermissions/);
    expect(src).toMatch(/export async function reportPreferences/);
  });

  it("getDeviceId uses localStorage mnexus.device.id", () => {
    const src = readFileSync(SRC("frontend/src/services/device_id.js"), "utf-8");
    expect(src).toMatch(/mnexus\.device\.id/);
    expect(src).toMatch(/localStorage\.getItem/);
    expect(src).toMatch(/localStorage\.setItem/);
  });

  it("registerDevice detects window.Capacitor → android platform", () => {
    const src = readFileSync(SRC("frontend/src/services/device_id.js"), "utf-8");
    expect(src).toMatch(/window\.Capacitor/);
    expect(src).toMatch(/@capacitor\/device/);
    expect(src).toMatch(/@capacitor\/app/);
    expect(src).toMatch(/manufacturer/);
    expect(src).toMatch(/model/);
    expect(src).toMatch(/osVersion/);
    expect(src).toMatch(/appVersion/);
  });

  it("registerDevice posts to /api/v1/devices/register", () => {
    const src = readFileSync(SRC("frontend/src/services/device_id.js"), "utf-8");
    expect(src).toMatch(/\/api\/v1\/devices\/register/);
    expect(src).toMatch(/POST/);
  });

  it("reportPermissions PATCHes /api/v1/devices/:id/permissions", () => {
    const src = readFileSync(SRC("frontend/src/services/device_id.js"), "utf-8");
    expect(src).toMatch(/\/api\/v1\/devices\/\$\{deviceId\}\/permissions/);
    expect(src).toMatch(/PATCH/);
  });

  it("starts heartbeat interval every 60s", () => {
    const src = readFileSync(SRC("frontend/src/services/device_id.js"), "utf-8");
    expect(src).toMatch(/HEARTBEAT_INTERVAL_MS = 60_000/);
    expect(src).toMatch(/setInterval/);
  });
});

describe("v2.19.0 — offline queue (IndexedDB)", () => {
  it("uses IndexedDB mnexus-offline + queue object store", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/DB_NAME = "mnexus-offline"/);
    expect(src).toMatch(/STORE = "queue"/);
    expect(src).toMatch(/indexedDB/);
  });

  it("exports enqueue, replay, size, peekAll, removeMany, clear", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/export async function enqueue/);
    expect(src).toMatch(/export async function replay/);
    expect(src).toMatch(/export async function size/);
    expect(src).toMatch(/export async function peekAll/);
    expect(src).toMatch(/export async function removeMany/);
    expect(src).toMatch(/export async function clear/);
  });

  it("replay posts to /api/v1/sync/replay with deviceId + entries[]", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/\/api\/v1\/sync\/replay/);
    expect(src).toMatch(/deviceId/);
    expect(src).toMatch(/entries/);
  });

  it("replay retries up to 5 times then drops", () => {
    const src = readFileSync(SRC("frontend/src/services/offline_queue.js"), "utf-8");
    expect(src).toMatch(/entry\.retries >= 4/);
  });
});

describe("v2.19.0 — api.js queues mutations offline", () => {
  it("imports offline_queue.js", () => {
    const src = readFileSync(SRC("frontend/src/services/api.js"), "utf-8");
    expect(src).toMatch(/import.*offline_queue/);
  });

  it("catches network errors and enqueues when queueOffline is set", () => {
    const src = readFileSync(SRC("frontend/src/services/api.js"), "utf-8");
    expect(src).toMatch(/queueOffline/);
    expect(src).toMatch(/enqueueOffline/);
    expect(src).toMatch(/isMutation/);
  });

  it("passes queueOffline on notes create/update/remove + flashcards review", () => {
    const src = readFileSync(SRC("frontend/src/services/api.js"), "utf-8");
    expect(src).toMatch(/queueOffline: true, queueType: "note"/);
    expect(src).toMatch(/queueOffline: true, queueType: "flashcard"/);
  });
});

describe("v2.19.0 — android_settings widget", () => {
  it("exports installAndroidSettings + injectIntoSettings", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/export async function installAndroidSettings/);
    expect(src).toMatch(/export async function injectIntoSettings/);
  });

  it("skips installation when window.Capacitor is absent", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/if \(!isCapacitor\(\)\) return/);
  });

  it("renders backend URL form + test connection button", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/name="backend-url"/);
    expect(src).toMatch(/test-backend/);
    expect(src).toMatch(/\/api\/v1\/health/);
  });

  it("renders permissions grid for storage/audio/notifications/battery", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/Notificaciones/);
    expect(src).toMatch(/Almacenamiento/);
    expect(src).toMatch(/Micrófono/);
    expect(src).toMatch(/Sin optimización de batería/);
    expect(src).toMatch(/Cámara/);
    expect(src).toMatch(/Ubicación/);
  });

  it("renders offline queue controls (drain + clear)", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/drain-queue/);
    expect(src).toMatch(/clear-queue/);
  });

  it("imports @capacitor/permissions for native permission queries", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/@capacitor\/permissions/);
  });
});

describe("v2.19.0 — main.js registers device on boot", () => {
  it("calls registerDevice() at boot", () => {
    const src = readFileSync(SRC("frontend/src/main.js"), "utf-8");
    expect(src).toMatch(/registerDevice/);
    expect(src).toMatch(/installAndroidSettings/);
  });
});
