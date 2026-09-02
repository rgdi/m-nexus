// Auth routes: register, refresh, revoke, audit.
// v0.12: JWT real con rotación de tokens.

import { FastifyInstance } from "fastify";
import { registerDevice, getDevice, isDeviceRegistered, blockDevice, updateDeviceToken } from "../auth/devices.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  validateRefreshToken,
  revokeAllForDevice,
  getRefreshTokenStats,
} from "../auth/jwt.js";
import { audit, getAuditForDevice } from "../auth/audit.js";
import { logger } from "../utils/log.js";

const VERSION = "0.28.0";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/register — alta inicial, devuelve access + refresh token
  app.post("/api/v1/register", async (req, reply) => {
    const body = req.body as {
      deviceId?: string;
      deviceName?: string;
      platform?: string;
      pluginVersion?: string;
      protocolVersion?: string;
      inviteToken?: string;
      publicKeyJwk?: JsonWebKey;
    };
    if (!body?.deviceId) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "deviceId requerido" });
      return;
    }
    // En producción: validar inviteToken. Aquí permitimos libre.
    const dev = registerDevice(body.deviceId, {
      deviceName: body.deviceName,
      platform: body.platform,
      pluginVersion: body.pluginVersion,
      publicKeyJwk: body.publicKeyJwk,
    });
    const access = signAccessToken(body.deviceId, body.deviceName);
    updateDeviceToken(body.deviceId, access.jti);
    const refresh = issueRefreshToken(body.deviceId);
    audit({ deviceId: body.deviceId, action: "register", allowed: true, meta: { name: body.deviceName, platform: body.platform } });
    logger.info({ deviceId: body.deviceId, name: body.deviceName }, "Device registered");
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenExpiresAt: Math.floor(refresh.expiresAt / 1000),
      serverVersion: VERSION,
      hasExistingState: dev.registeredAt < Date.now() - 1000,
    };
  });

  // POST /api/v1/auth/refresh — refresh token rotation
  app.post("/api/v1/auth/refresh", async (req, reply) => {
    const body = req.body as { refreshToken?: string };
    if (!body?.refreshToken) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "refreshToken requerido" });
      return;
    }
    const rec = validateRefreshToken(body.refreshToken);
    if (!rec) {
      audit({ deviceId: "(unknown)", action: "auth.failed", allowed: false, meta: { reason: "invalid_refresh" } });
      reply.code(401).send({ code: "INVALID_REFRESH", message: "Refresh token inválido o revocado" });
      return;
    }
    // Rotar: revoca el viejo y emite uno nuevo
    const newRefresh = rotateRefreshToken(body.refreshToken, rec.deviceId);
    const access = signAccessToken(rec.deviceId);
    updateDeviceToken(rec.deviceId, access.jti);
    audit({ deviceId: rec.deviceId, action: "auth.refresh", allowed: true });
    return {
      accessToken: access.token,
      refreshToken: newRefresh.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenExpiresAt: Math.floor(newRefresh.expiresAt / 1000),
    };
  });

  // POST /api/v1/auth/revoke — revoca todos los refresh tokens del device
  app.post("/api/v1/auth/revoke", async (req, reply) => {
    const deviceId = req.auth?.sub;
    if (!deviceId) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Autenticación requerida" });
      return;
    }
    const count = revokeAllForDevice(deviceId);
    audit({ deviceId, action: "auth.revoke", allowed: true, meta: { revokedCount: count } });
    return { ok: true, revoked: count };
  });

  // GET /api/v1/audit — log de accesos del propio device
  app.get("/api/v1/audit", async (req, reply) => {
    const deviceId = req.auth?.sub;
    if (!deviceId) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Autenticación requerida" });
      return;
    }
    const limit = Math.min(parseInt((req.query as { limit?: string }).limit ?? "100", 10) || 100, 500);
    return { entries: getAuditForDevice(deviceId, limit) };
  });

  // POST /api/v1/auth/block — admin: bloquea un device
  app.post("/api/v1/auth/block", async (req, reply) => {
    const deviceId = req.auth?.sub;
    if (!deviceId) {
      reply.code(401).send({ code: "UNAUTHORIZED", message: "Autenticación requerida" });
      return;
    }
    const body = req.body as { targetDeviceId?: string; blocked?: boolean };
    if (!body?.targetDeviceId) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "targetDeviceId requerido" });
      return;
    }
    blockDevice(body.targetDeviceId, body.blocked !== false);
    revokeAllForDevice(body.targetDeviceId);
    return { ok: true };
  });
}
