// Tests del sistema de auth (JWT, refresh, audit, devices).
// v0.12: seguridad real con tokens.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server.js";
import {
  signAccessToken,
  issueRefreshToken,
  validateRefreshToken,
  rotateRefreshToken,
  revokeAllForDevice,
} from "../src/auth/jwt.js";
import { audit, getAuditForDevice, getAuditStats } from "../src/auth/audit.js";
import {
  registerDevice,
  isDeviceRegistered,
  getDevice,
  blockDevice,
} from "../src/auth/devices.js";
import type { FastifyInstance } from "fastify";

describe("JWT Auth", () => {
  it("signAccessToken genera un JWT válido", () => {
    const t = signAccessToken("test-device-1", "Test");
    expect(t.token).toBeTruthy();
    expect(t.token.split(".")).toHaveLength(3);
    expect(t.jti).toBeTruthy();
    expect(t.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("verifyAccessToken acepta tokens válidos", async () => {
    const { verifyAccessToken } = await import("../src/auth/jwt.js");
    const t = signAccessToken("d1");
    const payload = verifyAccessToken(t.token);
    expect(payload.sub).toBe("d1");
    expect(payload.jti).toBe(t.jti);
  });

  it("verifyAccessToken rechaza tokens inválidos", async () => {
    const { verifyAccessToken } = await import("../src/auth/jwt.js");
    expect(() => verifyAccessToken("invalid.token.here")).toThrow();
    expect(() => verifyAccessToken("not-a-jwt")).toThrow();
  });

  it("issueRefreshToken genera un token con formato id.payload", () => {
    const t = issueRefreshToken("d1");
    expect(t.token).toContain(".");
    const [id] = t.token.split(".");
    expect(id).toHaveLength(32);
  });

  it("validateRefreshToken devuelve el record si es válido", () => {
    const t = issueRefreshToken("d2");
    const rec = validateRefreshToken(t.token);
    expect(rec).not.toBeNull();
    expect(rec?.deviceId).toBe("d2");
    expect(rec?.revoked).toBe(false);
  });

  it("rotateRefreshToken revoca el viejo y emite uno nuevo", () => {
    const oldToken = issueRefreshToken("d3");
    const newToken = rotateRefreshToken(oldToken.token, "d3");
    expect(newToken.token).not.toBe(oldToken.token);
    expect(validateRefreshToken(oldToken.token)).toBeNull(); // viejo revocado
    expect(validateRefreshToken(newToken.token)).not.toBeNull(); // nuevo válido
  });

  it("revokeAllForDevice invalida todos los tokens del device", () => {
    const t1 = issueRefreshToken("d4");
    const t2 = issueRefreshToken("d4");
    const t3 = issueRefreshToken("d5");
    const revoked = revokeAllForDevice("d4");
    expect(revoked).toBe(2);
    expect(validateRefreshToken(t1.token)).toBeNull();
    expect(validateRefreshToken(t2.token)).toBeNull();
    expect(validateRefreshToken(t3.token)).not.toBeNull(); // d5 intacto
  });
});

describe("Audit log", () => {
  it("registra y recupera entradas por device", () => {
    audit({ deviceId: "audit-1", action: "audio.transcribe", allowed: true, meta: { bytes: 1000 } });
    audit({ deviceId: "audit-1", action: "llm.chat", allowed: true });
    audit({ deviceId: "audit-2", action: "audio.transcribe", allowed: true });
    const e1 = getAuditForDevice("audit-1");
    expect(e1.length).toBeGreaterThanOrEqual(2);
    expect(e1.every((e) => e.deviceId === "audit-1")).toBe(true);
  });

  it("registra stats por acción", () => {
    audit({ deviceId: "audit-stats", action: "auth.refresh", allowed: true });
    audit({ deviceId: "audit-stats", action: "auth.refresh", allowed: true });
    audit({ deviceId: "audit-stats", action: "auth.refresh", allowed: true });
    const s = getAuditStats();
    expect(s.total).toBeGreaterThanOrEqual(3);
    expect(s.byAction["auth.refresh"]).toBeGreaterThanOrEqual(3);
  });
});

describe("Devices registry", () => {
  it("registerDevice y lookup", () => {
    const d = registerDevice("reg-1", { deviceName: "Test", platform: "linux" });
    expect(d.deviceId).toBe("reg-1");
    expect(d.deviceName).toBe("Test");
    expect(isDeviceRegistered("reg-1")).toBe(true);
    expect(isDeviceRegistered("nope")).toBe(false);
  });

  it("registerDevice actualiza info si ya existe", () => {
    registerDevice("reg-2", { deviceName: "Old" });
    registerDevice("reg-2", { deviceName: "New", pluginVersion: "1.0" });
    const d = getDevice("reg-2");
    expect(d?.deviceName).toBe("New");
    expect(d?.pluginVersion).toBe("1.0");
  });

  it("blockDevice marca y desmarca", () => {
    registerDevice("reg-3", {});
    blockDevice("reg-3", true);
    expect(getDevice("reg-3")?.blocked).toBe(true);
    blockDevice("reg-3", false);
    expect(getDevice("reg-3")?.blocked).toBe(false);
  });
});

describe("HTTP /api/v1/auth/refresh", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "object" && addr) {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("register devuelve access + refresh tokens", async () => {
    const res = await fetch(`${baseUrl}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "auth-http-1", deviceName: "Test" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as {
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: number;
      refreshTokenExpiresAt: number;
      serverVersion: string;
    };
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.accessTokenExpiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(data.serverVersion).toBeTruthy();
  });

  it("refresh rota el token y devuelve uno nuevo", async () => {
    const reg = await fetch(`${baseUrl}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "auth-http-2" }),
    });
    const { refreshToken: oldToken } = await reg.json() as { refreshToken: string };
    const ref = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: oldToken }),
    });
    expect(ref.status).toBe(200);
    const { refreshToken: newToken } = await ref.json() as { refreshToken: string };
    expect(newToken).not.toBe(oldToken);

    // El viejo ya no funciona
    const ref2 = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: oldToken }),
    });
    expect(ref2.status).toBe(401);
  });

  it("refresh con token inválido devuelve 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "invalid.token" }),
    });
    expect(res.status).toBe(401);
  });

  it("refresh sin token devuelve 400", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("endpoint protegido sin auth devuelve 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/llm/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hola" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("endpoint protegido con auth válido funciona", async () => {
    const reg = await fetch(`${baseUrl}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "auth-http-3" }),
    });
    const { accessToken } = await reg.json() as { accessToken: string };
    const res = await fetch(`${baseUrl}/api/v1/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hola" }] }),
    });
    expect(res.status).toBe(200);
  });

  it("token inválido devuelve 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer invalid.token.here",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hola" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/audit devuelve solo las entradas del propio device", async () => {
    const reg = await fetch(`${baseUrl}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "auth-audit" }),
    });
    const { accessToken } = await reg.json() as { accessToken: string };
    // Hacer un par de requests autenticados
    await fetch(`${baseUrl}/api/v1/llm/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({ messages: [{ role: "user", content: "a" }] }),
    });
    const res = await fetch(`${baseUrl}/api/v1/audit`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { entries: Array<{ deviceId: string }> };
    expect(data.entries.every((e) => e.deviceId === "auth-audit")).toBe(true);
  });

  it("/api/v1/auth/revoke revoca tokens", async () => {
    const reg = await fetch(`${baseUrl}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "auth-revoke" }),
    });
    const { accessToken, refreshToken } = await reg.json() as { accessToken: string; refreshToken: string };
    const rev = await fetch(`${baseUrl}/api/v1/auth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${accessToken}` },
      body: JSON.stringify({}),
    });
    expect(rev.status).toBe(200);
    const ref = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    expect(ref.status).toBe(401);
  });
});
