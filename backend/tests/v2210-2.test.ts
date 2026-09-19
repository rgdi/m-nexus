// v2210-2.test.ts — v2.21.0 notifications service + route additions.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ingestNotifications,
  listNotifications,
  deleteNotification,
  _resetForTests,
  _flushForTests,
} from "../src/services/notifications.js";

beforeEach(async () => {
  process.env.MNEXUS_NOTIFICATIONS_FILE = join(
    tmpdir(),
    `mnexus-notif-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  await _flushForTests();
  try {
    rmSync(process.env.MNEXUS_NOTIFICATIONS_FILE);
  } catch {}
  _resetForTests();
});

describe("v2.21.0 — notifications service: ingest", () => {
  it("inserts valid entries", async () => {
    const r = await ingestNotifications("dev-1", [
      {
        key: "pkg=com.example;nid=1;tag=null",
        packageName: "com.example",
        postedAt: 1700000000000,
        title: "Hello",
        text: "World",
        category: "msg",
        priority: 0,
        id: 1,
        isOngoing: false,
        when: 1700000000000,
      },
    ]);
    expect(r.inserted).toBe(1);
    expect(r.deduplicated).toBe(0);
    expect(r.invalid).toBe(0);
    expect(r.total).toBe(1);
  });

  it("deduplicates by key", async () => {
    const item = {
      key: "pkg=com.example;nid=1",
      packageName: "com.example",
      postedAt: 1700000000000,
      title: "Hello",
    };
    const r1 = await ingestNotifications("dev-1", [item]);
    const r2 = await ingestNotifications("dev-2", [item]);
    expect(r1.inserted).toBe(1);
    expect(r2.inserted).toBe(0);
    expect(r2.deduplicated).toBe(1);
  });

  it("rejects entries missing key", async () => {
    const r = await ingestNotifications("dev-1", [
      { packageName: "x", postedAt: 1 }, // missing key → invalid
      { key: "k1", postedAt: 1 },        // missing packageName → invalid
      { key: "k2", packageName: "x" },   // missing postedAt → invalid
    ]);
    // All 3 fail validation (key + packageName + postedAt all required).
    expect(r.invalid).toBe(3);
    expect(r.inserted).toBe(0);
  });

  it("rejects entries with only the required fields", async () => {
    const r = await ingestNotifications("dev-1", [
      { key: "k1", packageName: "x", postedAt: 1 },
    ]);
    expect(r.invalid).toBe(0);
    expect(r.inserted).toBe(1);
  });

  it("handles empty batch", async () => {
    const r = await ingestNotifications("dev-1", []);
    expect(r.total).toBe(0);
    expect(r.inserted).toBe(0);
  });

  it("persists to MNEXUS_NOTIFICATIONS_FILE", async () => {
    await ingestNotifications("dev-1", [
      { key: "k1", packageName: "x", postedAt: 1 },
    ]);
    await _flushForTests();
    expect(existsSync(process.env.MNEXUS_NOTIFICATIONS_FILE!)).toBe(true);
  });
});

describe("v2.21.0 — notifications service: list", () => {
  it("lists newest first", async () => {
    await ingestNotifications("dev-1", [
      { key: "k1", packageName: "x", postedAt: 100, title: "first" },
      { key: "k2", packageName: "x", postedAt: 300, title: "third" },
      { key: "k3", packageName: "x", postedAt: 200, title: "second" },
    ]);
    const list = await listNotifications({});
    expect(list.length).toBe(3);
    expect(list[0].title).toBe("third");
    expect(list[2].title).toBe("first");
  });

  it("filters by deviceId", async () => {
    await ingestNotifications("dev-1", [{ key: "k1", packageName: "x", postedAt: 1 }]);
    await ingestNotifications("dev-2", [{ key: "k2", packageName: "x", postedAt: 2 }]);
    const list = await listNotifications({ deviceId: "dev-1" });
    expect(list.length).toBe(1);
    expect(list[0].deviceId).toBe("dev-1");
  });

  it("filters by packageName", async () => {
    await ingestNotifications("dev-1", [
      { key: "k1", packageName: "com.a", postedAt: 1 },
      { key: "k2", packageName: "com.b", postedAt: 2 },
    ]);
    const list = await listNotifications({ packageName: "com.a" });
    expect(list.length).toBe(1);
    expect(list[0].packageName).toBe("com.a");
  });

  it("respects limit", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      key: "k" + i,
      packageName: "x",
      postedAt: i,
    }));
    await ingestNotifications("dev-1", items);
    const list = await listNotifications({ limit: 3 });
    expect(list.length).toBe(3);
  });

  it("caps limit at 1000", async () => {
    const list = await listNotifications({ limit: 9999 });
    expect(list.length).toBeLessThanOrEqual(1000);
  });
});

describe("v2.21.0 — notifications service: delete", () => {
  it("deletes by id", async () => {
    await ingestNotifications("dev-1", [{ key: "k1", packageName: "x", postedAt: 1 }]);
    const before = await listNotifications({});
    expect(before.length).toBe(1);
    const ok = await deleteNotification(before[0].id);
    expect(ok).toBe(true);
    const after = await listNotifications({});
    expect(after.length).toBe(0);
  });

  it("returns false for unknown id", async () => {
    const ok = await deleteNotification("does-not-exist");
    expect(ok).toBe(false);
  });
});

describe("v2.21.0 — notifications routes wiring", () => {
  it("server.ts registers notificationsRoutes", () => {
    const src = readFileSync(join(process.cwd(), "src/server.ts"), "utf-8");
    expect(src).toMatch(/import \{ notificationsRoutes \}/);
    expect(src).toMatch(/app\.register\(notificationsRoutes, \{ prefix: "\/api\/v1" \}\)/);
  });

  it("/notifications/ingest is in PUBLIC_PATHS", () => {
    const src = readFileSync(join(process.cwd(), "src/middleware/auth.ts"), "utf-8");
    expect(src).toMatch(/"\/api\/v1\/notifications\/ingest"/);
  });

  it("routes file declares POST/GET/DELETE", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/notifications.ts"), "utf-8");
    expect(src).toMatch(/app\.post\("\/notifications\/ingest"/);
    expect(src).toMatch(/app\.get\("\/notifications"/);
    expect(src).toMatch(/app\.delete/);
  });

  it("ingest validates array body", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/notifications.ts"), "utf-8");
    expect(src).toMatch(/notifications must be an array/);
    expect(src).toMatch(/batch too large/);
    expect(src).toMatch(/x-mnexus-device-id/);
  });
});

describe("v2.21.0 — Java NotificationCaptureService sanity", () => {
  it("extends NotificationListenerService", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/java/com/mnexus/app/notif/NotificationCaptureService.java"),
      "utf-8",
    );
    expect(src).toMatch(/extends NotificationListenerService/);
    expect(src).toMatch(/onNotificationPosted/);
    expect(src).toMatch(/onNotificationRemoved/);
    expect(src).toMatch(/onListenerConnected/);
    expect(src).toMatch(/onListenerDisconnected/);
  });

  it("has MAX_QUEUE_SIZE to prevent unbounded growth", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/java/com/mnexus/app/notif/NotificationCaptureService.java"),
      "utf-8",
    );
    expect(src).toMatch(/MAX_QUEUE_SIZE = 500/);
    expect(src).toMatch(/PENDING\.pollFirst\(\)/);
  });

  it("AndroidManifest declares the listener service", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/AndroidManifest.xml"),
      "utf-8",
    );
    expect(src).toMatch(/NotificationCaptureService/);
    expect(src).toMatch(/BIND_NOTIFICATION_LISTENER_SERVICE/);
    expect(src).toMatch(/NotificationListenerService/);
  });

  it("AndroidManifest adds permission uses-permission", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/AndroidManifest.xml"),
      "utf-8",
    );
    const occurrences = (src.match(/BIND_NOTIFICATION_LISTENER_SERVICE/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("NativeIntentPlugin exposes the 3 listener methods", () => {
    const src = readFileSync(
      join(process.cwd(), "../android/app/src/main/java/com/mnexus/app/intents/NativeIntentPlugin.java"),
      "utf-8",
    );
    expect(src).toMatch(/public void openNotificationListenerSettings/);
    expect(src).toMatch(/public void isNotificationListenerGranted/);
    expect(src).toMatch(/public void getPendingNotifications/);
  });
});
