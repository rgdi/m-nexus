// v2190.test.ts — v2.19.0 backend additions:
// - Device registry (register, update permissions, update preferences, heartbeat)
// - Offline replay endpoint
// - public paths include new endpoints

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerDevice,
  updateDevicePermissions,
  updateDevicePreferences,
  isDeviceRegistered,
  getDevice,
  getRegisteredDevices,
  blockDevice,
  getDevicesForUser,
} from "../src/auth/devices.js";

describe("v2.19.0 — device registry", () => {
  it("registerDevice creates a new record with extended fields", async () => {
    const d = await registerDevice({
      deviceId: "test-d-001",
      deviceName: "Samsung SM-T870",
      platform: "android",
      appVersion: "2.19.0",
      osVersion: "Android 14",
      manufacturer: "Samsung",
      model: "SM-T870",
      pluginVersion: "8.0.0",
    });
    expect(d.deviceId).toBe("test-d-001");
    expect(d.platform).toBe("android");
    expect(d.appVersion).toBe("2.19.0");
    expect(d.manufacturer).toBe("Samsung");
    expect(d.model).toBe("SM-T870");
    expect(d.registeredAt).toBeGreaterThan(0);
    expect(d.lastSeenAt).toBeGreaterThan(0);
    expect(isDeviceRegistered("test-d-001")).toBe(true);
  });

  it("registerDevice is idempotent — re-registration merges fields", async () => {
    await registerDevice({
      deviceId: "test-d-002",
      deviceName: "Phone",
      platform: "android",
    });
    const rereg = await registerDevice({
      deviceId: "test-d-002",
      appVersion: "2.19.1",
      osVersion: "Android 15",
    });
    expect(rereg.deviceName).toBe("Phone"); // preserved
    expect(rereg.appVersion).toBe("2.19.1"); // updated
    expect(rereg.platform).toBe("android"); // preserved
  });

  it("registerDevice rejects empty deviceId", async () => {
    await expect(registerDevice({ deviceId: "" })).rejects.toThrow();
    await expect(registerDevice({ deviceId: "ab" })).rejects.toThrow();
  });

  it("updateDevicePermissions merges per-field", async () => {
    await registerDevice({ deviceId: "test-d-003", platform: "android" });
    const d1 = await updateDevicePermissions("test-d-003", {
      storage: true,
      notifications: true,
    });
    expect(d1?.permissions?.storage).toBe(true);
    expect(d1?.permissions?.notifications).toBe(true);
    const d2 = await updateDevicePermissions("test-d-003", {
      audio: true,
      notifications: false,
    });
    expect(d2?.permissions?.storage).toBe(true); // preserved
    expect(d2?.permissions?.audio).toBe(true); // added
    expect(d2?.permissions?.notifications).toBe(false); // updated
  });

  it("updateDevicePreferences merges", async () => {
    await registerDevice({ deviceId: "test-d-004" });
    await updateDevicePreferences("test-d-004", { backendUrl: "http://x:4100" });
    const d = await updateDevicePreferences("test-d-004", { syncIntervalMinutes: 10 });
    expect(d?.preferences?.backendUrl).toBe("http://x:4100");
    expect(d?.preferences?.syncIntervalMinutes).toBe(10);
  });

  it("updateDevicePermissions returns null for unknown device", async () => {
    const d = await updateDevicePermissions("non-existent-device", { audio: true });
    expect(d).toBeNull();
  });

  it("getDevice / getRegisteredDevices / getDevicesForUser", async () => {
    await registerDevice({ deviceId: "test-d-005", userId: "user-A" });
    await registerDevice({ deviceId: "test-d-006", userId: "user-A" });
    await registerDevice({ deviceId: "test-d-007", userId: "user-B" });
    const userA = getDevicesForUser("user-A");
    expect(userA).toHaveLength(2);
    expect(getRegisteredDevices().length).toBeGreaterThanOrEqual(3);
    expect(getDevice("test-d-005")?.userId).toBe("user-A");
  });

  it("blockDevice sets blocked flag", async () => {
    await registerDevice({ deviceId: "test-d-008" });
    blockDevice("test-d-008", true);
    expect(getDevice("test-d-008")?.blocked).toBe(true);
    blockDevice("test-d-008", false);
    expect(getDevice("test-d-008")?.blocked).toBe(false);
  });
});

describe("v2.19.0 — sync replay routes source", () => {
  it("syncReplay.ts has replay endpoint", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/syncReplay.ts"), "utf-8");
    expect(src).toMatch(/sync\/replay/);
    expect(src).toMatch(/applyMessageToStore/);
    expect(src).toMatch(/EC-SYNC-001/);
    expect(src).toMatch(/EC-SYNC-002/);
    expect(src).toMatch(/EC-SYNC-003/);
  });

  it("sync_replay sorts by client timestamp ascending", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/syncReplay.ts"), "utf-8");
    expect(src).toMatch(/sort\(/);
    expect(src).toMatch(/\(a\.ts \|\| 0\) - \(b\.ts \|\| 0\)/);
  });
});

describe("v2.19.0 — applyMessageToStore is exported", () => {
  it("sync_v2.ts exports applyMessageToStore", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/sync_v2.ts"), "utf-8");
    expect(src).toMatch(/export function applyMessageToStore/);
  });
});

describe("v2.19.0 — public paths", () => {
  it("/api/v1/devices/register is in PUBLIC_PATHS", () => {
    const src = readFileSync(join(process.cwd(), "src/middleware/auth.ts"), "utf-8");
    expect(src).toMatch(/"\/api\/v1\/devices\/register"/);
  });

  it("/api/v1/sync/replay is in PUBLIC_PATHS", () => {
    const src = readFileSync(join(process.cwd(), "src/middleware/auth.ts"), "utf-8");
    expect(src).toMatch(/"\/api\/v1\/sync\/replay"/);
  });
});

describe("v2.19.0 — devices routes registered", () => {
  it("server.ts imports deviceRoutes + syncReplayRoutes", () => {
    const src = readFileSync(join(process.cwd(), "src/server.ts"), "utf-8");
    expect(src).toMatch(/deviceRoutes/);
    expect(src).toMatch(/syncReplayRoutes/);
  });
});
