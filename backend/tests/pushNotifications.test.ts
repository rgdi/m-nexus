// v0.21: Tests del servicio de push notifications.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerToken,
  listTokens,
  removeToken,
  sendPush,
  broadcastToUser,
  getPushStats,
  type PushToken,
} from "../src/services/pushNotifications.js";

function makeToken(over: Partial<PushToken> = {}): PushToken {
  return {
    deviceId: "dev-1",
    token: "test-token",
    platform: "android",
    registeredAt: Date.now(),
    lastSeenAt: Date.now(),
    ...over,
  };
}

describe("Push Notifications — registro", () => {
  beforeEach(() => {
    listTokens().forEach((t) => removeToken(t.deviceId));
  });

  it("registerToken: añade un token", () => {
    registerToken(makeToken({ deviceId: "d1" }));
    expect(listTokens()).toHaveLength(1);
  });

  it("registerToken: múltiples tokens", () => {
    registerToken(makeToken({ deviceId: "d1" }));
    registerToken(makeToken({ deviceId: "d2" }));
    registerToken(makeToken({ deviceId: "d3" }));
    expect(listTokens()).toHaveLength(3);
  });

  it("removeToken: elimina un token existente", () => {
    registerToken(makeToken({ deviceId: "d1" }));
    expect(removeToken("d1")).toBe(true);
    expect(listTokens()).toHaveLength(0);
  });

  it("removeToken: retorna false si no existe", () => {
    expect(removeToken("inexistente")).toBe(false);
  });

  it("getPushStats: cuenta tokens por plataforma", () => {
    registerToken(makeToken({ deviceId: "a1", platform: "android" }));
    registerToken(makeToken({ deviceId: "a2", platform: "android" }));
    registerToken(makeToken({ deviceId: "i1", platform: "ios" }));
    const stats = getPushStats();
    expect(stats.totalTokens).toBe(3);
    expect(stats.androidTokens).toBe(2);
    expect(stats.iosTokens).toBe(1);
  });

  it("getPushStats: devMode = true sin credenciales", () => {
    // No hay env vars FCM/APNs
    const stats = getPushStats();
    expect(stats.devMode).toBe(true);
  });
});

describe("Push Notifications — envío (dev mode)", () => {
  beforeEach(() => {
    listTokens().forEach((t) => removeToken(t.deviceId));
  });

  it("sendPush: device no registrado → error", async () => {
    const r = await sendPush("no-existe", { title: "T", body: "B" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("not found");
  });

  it("sendPush: device registrado → simula envío OK", async () => {
    registerToken(makeToken({ deviceId: "d1", platform: "android" }));
    const r = await sendPush("d1", { title: "Hola", body: "Mundo" });
    expect(r.success).toBe(true);
    expect(r.platform).toBe("android");
  });

  it("sendPush: iOS simulado", async () => {
    registerToken(makeToken({ deviceId: "d1", platform: "ios" }));
    const r = await sendPush("d1", { title: "T", body: "B" });
    expect(r.success).toBe(true);
    expect(r.platform).toBe("ios");
  });

  it("sendPush: actualiza lastSeenAt", async () => {
    registerToken(makeToken({ deviceId: "d1" }));
    const before = listTokens().find((t) => t.deviceId === "d1")!.lastSeenAt;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await sendPush("d1", { title: "T", body: "B" });
    const after = listTokens().find((t) => t.deviceId === "d1")!.lastSeenAt;
    expect(after).toBeGreaterThan(before);
  });

  it("sendPush: incluye data y category en payload", async () => {
    registerToken(makeToken({ deviceId: "d1" }));
    const r = await sendPush("d1", {
      title: "T",
      body: "B",
      data: { examId: "e1" },
      category: "exam-approaching",
    });
    expect(r.success).toBe(true);
  });

  it("broadcastToUser: envía a todos los devices del user", async () => {
    registerToken(makeToken({ deviceId: "user-1-device-1" }));
    registerToken(makeToken({ deviceId: "user-1-device-2" }));
    registerToken(makeToken({ deviceId: "user-2-device-1" }));
    const results = await broadcastToUser("user-1", { title: "T", body: "B" });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("broadcastToUser: 0 devices para user desconocido", async () => {
    const results = await broadcastToUser("no-existe", { title: "T", body: "B" });
    expect(results).toHaveLength(0);
  });
});
