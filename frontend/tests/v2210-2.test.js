// v2210-2.test.js — v2.21.0 notif_capture + android_settings additions.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.21.0 — native_intents notif listener helpers", () => {
  it("exports openNotificationListenerSettings + isNotificationListenerGranted + getPendingNotifications", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/export async function openNotificationListenerSettings/);
    expect(src).toMatch(/export async function isNotificationListenerGranted/);
    expect(src).toMatch(/export async function getPendingNotifications/);
  });

  it("web fallback returns safe defaults", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/granted: false, connected: false, pendingCount: 0/);
  });
});

describe("v2.21.0 — notif_capture service", () => {
  it("exports installNotificationCapture with a stop()", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/export function installNotificationCapture/);
    expect(src).toMatch(/return \{ stop: \(\) =>/);
  });

  it("polls every 30s default", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/30_000|POLL_INTERVAL_MS = 30000/);
  });

  it("POSTs to /api/v1/notifications/ingest with x-mnexus-device-id header", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/notifications\/ingest/);
    expect(src).toMatch(/x-mnexus-device-id/);
  });

  it("skips when not granted", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/if \(!status\.granted\) return/);
  });

  it("skips empty queues", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/items\.length === 0/);
  });

  it("batches up to batchSize (default 20)", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/BATCH_SIZE = 20/);
    expect(src).toMatch(/i \+= batchSize/);
  });

  it("is idempotent (only one install per session)", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/installNotificationCapture\._installed/);
  });
});

describe("v2.21.0 — android_settings wires notification listener", () => {
  it("imports the notif listener helpers", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toContain("openNotificationListenerSettings");
    expect(src).toContain("isNotificationListenerGranted");
  });

  it("adds a notificationListener permission row", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/id: "notificationListener"/);
    expect(src).toMatch(/BIND_NOTIFICATION_LISTENER_SERVICE/);
  });

  it("queries notification listener grant status", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/const nl = await isNotificationListenerGranted/);
  });

  it("renders a 'Configurar' button for notif listener row", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/data-notif-listener-btn/);
    expect(src).toMatch(/>Configurar</);
  });

  it("re-queries status 1.5s after opening settings", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/setTimeout\(async \(\) => \{[\s\S]{0,300}isNotificationListenerGranted/);
  });
});

describe("v2.21.0 — main.js wires notif_capture on boot", () => {
  it("imports installNotificationCapture from notif_capture", () => {
    const src = readFileSync(SRC("frontend/src/main.js"), "utf-8");
    expect(src).toContain("installNotificationCapture");
    expect(src).toMatch(/notif_capture\.js/);
  });
});
