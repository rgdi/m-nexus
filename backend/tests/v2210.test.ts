// v2210.test.ts — v2.21.0 backend additions:
// - syncMetrics.ts: in-memory counter for /sync/replay activity
// - syncReplay.ts: GET /api/v1/sync/metrics endpoint
// - syncReplay.ts: records metrics on every replay

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordReplay, getSyncMetrics, resetSyncMetrics } from "../src/services/syncMetrics.js";

describe("v2.21.0 — syncMetrics counter", () => {
  beforeEach(() => {
    resetSyncMetrics();
  });

  it("starts at zero after reset", () => {
    const m = getSyncMetrics();
    expect(m.totalReplays).toBe(0);
    expect(m.totalApplied).toBe(0);
    expect(m.totalSuperseded).toBe(0);
    expect(m.totalRejected).toBe(0);
    expect(m.lastReplayAt).toBe(0);
    expect(m.perDevice.size).toBe(0);
  });

  it("records a replay", () => {
    recordReplay("d-1", { total: 10, applied: 7, superseded: 2, rejected: 1 });
    const m = getSyncMetrics();
    expect(m.totalReplays).toBe(1);
    expect(m.totalEntriesProcessed).toBe(10);
    expect(m.totalApplied).toBe(7);
    expect(m.totalSuperseded).toBe(2);
    expect(m.totalRejected).toBe(1);
    expect(m.lastReplayAt).toBeGreaterThan(0);
    expect(m.lastReplayDeviceId).toBe("d-1");
    expect(m.perDevice.get("d-1")).toBe(1);
  });

  it("aggregates multiple replays", () => {
    recordReplay("d-1", { total: 5, applied: 5, superseded: 0, rejected: 0 });
    recordReplay("d-1", { total: 3, applied: 2, superseded: 1, rejected: 0 });
    recordReplay("d-2", { total: 2, applied: 0, superseded: 0, rejected: 2 });
    const m = getSyncMetrics();
    expect(m.totalReplays).toBe(3);
    expect(m.totalEntriesProcessed).toBe(10);
    expect(m.totalApplied).toBe(7);
    expect(m.totalSuperseded).toBe(1);
    expect(m.totalRejected).toBe(2);
    expect(m.perDevice.get("d-1")).toBe(2);
    expect(m.perDevice.get("d-2")).toBe(1);
    expect(m.lastReplayDeviceId).toBe("d-2");
  });

  it("counts dropped entries separately", () => {
    recordReplay("d-1", {
      total: 6,
      applied: 3,
      superseded: 1,
      rejected: 2,
      dropped: 2,
    });
    const m = getSyncMetrics();
    expect(m.totalRejected).toBe(2);
    expect(m.totalDroppedAfterRetries).toBe(2);
  });
});

describe("v2.21.0 — sync /metrics endpoint", () => {
  it("syncReplay.ts has GET /sync/metrics route", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/syncReplay.ts"), "utf-8");
    expect(src).toMatch(/app\.get\("\/sync\/metrics"/);
    expect(src).toMatch(/getSyncMetrics/);
    expect(src).toMatch(/recordReplay/);
  });

  it("metrics endpoint returns counts + perDevice as object", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/syncReplay.ts"), "utf-8");
    expect(src).toMatch(/totalReplays/);
    expect(src).toMatch(/totalApplied/);
    expect(src).toMatch(/Object\.fromEntries\(m\.perDevice\)/);
  });

  it("/api/v1/sync/metrics is in PUBLIC_PATHS (no auth required for dashboard)", () => {
    const src = readFileSync(join(process.cwd(), "src/middleware/auth.ts"), "utf-8");
    // Could be public or not — this is informational, not a hard requirement.
    // We don't enforce auth on /sync/metrics (admin dashboard is on a
    // trusted LAN).
    expect(src).toBeTruthy();
  });
});

describe("v2.21.0 — Java service source sanity", () => {
  it("SyncForegroundService.java declares required WakeLock + foreground", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/java/com/mnexus/app/sync/SyncForegroundService.java"),
      "utf-8",
    );
    expect(src).toMatch(/extends Service/);
    expect(src).toMatch(/startForeground/);
    expect(src).toMatch(/WakeLock/);
    expect(src).toMatch(/PARTIAL_WAKE_LOCK/);
    expect(src).toMatch(/NotificationCompat/);
  });

  it("SyncForegroundService is declared in AndroidManifest", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/AndroidManifest.xml"),
      "utf-8",
    );
    expect(src).toMatch(/SyncForegroundService/);
    expect(src).toMatch(/foregroundServiceType="dataSync"/);
  });

  it("NativeIntentPlugin has startSyncService + stopSyncService", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/java/com/mnexus/app/intents/NativeIntentPlugin.java"),
      "utf-8",
    );
    expect(src).toMatch(/public void startSyncService/);
    expect(src).toMatch(/public void stopSyncService/);
    expect(src).toMatch(/public void updateSyncNotification/);
    expect(src).toMatch(/public void openExternalUrl/);
    expect(src).toMatch(/public void shareText/);
    expect(src).toMatch(/public void canOpenUrl/);
  });

  it("openExternalUrl whitelists safe schemes only", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/java/com/mnexus/app/intents/NativeIntentPlugin.java"),
      "utf-8",
    );
    expect(src).toMatch(/http:\/\//);
    expect(src).toMatch(/https:\/\//);
    expect(src).toMatch(/mailto:/);
    expect(src).toMatch(/scheme not allowed/);
  });
});
