// Auth routes: register, refresh, revoke, audit.
// v0.12: JWT real con rotación de tokens.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { registerDevice, getDevice, isDeviceRegistered, updateDeviceToken } from "../auth/devices.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  validateRefreshToken,
  revokeAllForDevice,
} from "../auth/jwt.js";
import { audit, getAuditForDevice } from "../auth/audit.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logger, logOp } from "../utils/log.js";

const VERSION = "0.28.0";

interface RegisterBody {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  pluginVersion?: string;
  protocolVersion?: string;
  inviteToken?: string;
  publicKeyJwk?: JsonWebKey;
}

interface RefreshBody {
  refreshToken?: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/register — alta inicial, devuelve access + refresh token
  app.post("/api/v1/register", async (req, reply) => {
    const body = (req.body ?? {}) as RegisterBody;
    const r = await safeCallAsync({
      component: "auth",
      code: "EC-AUTH-020",
      message: "register endpoint failed",
      context: { hasDeviceId: !!body.deviceId, platform: body.platform },
      op: async () => {
        if (!body.deviceId) {
          throw E.val("EC-AUTH-021", "deviceId requerido", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { deviceId: 'uuid', deviceName, platform, ... }",
          });
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
        logOp("auth", "device registered", true, { deviceId: body.deviceId, name: body.deviceName });
        return {
          accessToken: access.token,
          refreshToken: refresh.token,
          accessTokenExpiresAt: access.expiresAt,
          refreshTokenExpiresAt: Math.floor(refresh.expiresAt / 1000),
          serverVersion: VERSION,
          hasExistingState: dev.registeredAt < Date.now() - 1000,
        };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/auth/refresh — refresh token rotation
  app.post("/api/v1/auth/refresh", async (req, reply) => {
    const body = (req.body ?? {}) as RefreshBody;
    const r = await safeCallAsync({
      component: "auth",
      code: "EC-AUTH-022",
      message: "refresh endpoint failed",
      context: { hasRefreshToken: !!body.refreshToken },
      op: async () => {
        if (!body.refreshToken) {
          throw E.val("EC-AUTH-023", "refreshToken requerido", {
            hint: "Send { refreshToken: '...' }",
          });
        }
        const rec = validateRefreshToken(body.refreshToken);
        if (!rec) {
          audit({ deviceId: "(unknown)", action: "auth.failed", allowed: false, meta: { reason: "invalid_refresh" } });
          throw E.auth("EC-AUTH-024", "Refresh token inválido o revocado", {
            context: { tokenPrefix: body.refreshToken.substring(0, 8) },
            hint: "Re-register to get new tokens",
          });
        }
        // Rotar: revoca el viejo y emite uno nuevo
        const newRefresh = rotateRefreshToken(body.refreshToken, rec.deviceId);
        const access = signAccessToken(rec.deviceId);
        updateDeviceToken(rec.deviceId, access.jti);
        audit({ deviceId: rec.deviceId, action: "auth.refresh", allowed: true });
        logOp("auth", "token refreshed", true, { deviceId: rec.deviceId });
        return {
          accessToken: access.token,
          refreshToken: newRefresh.token,
          accessTokenExpiresAt: access.expiresAt,
          refreshTokenExpiresAt: Math.floor(newRefresh.expiresAt / 1000),
        };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/auth/revoke — revoca todos los refresh tokens del device
  app.post("/api/v1/auth/revoke", async (req, reply) => {
    const deviceId = req.auth?.sub;
    if (!deviceId) {
      throw E.auth("EC-AUTH-025", "Autenticación requerida", { hint: "Send Authorization header" });
    }
    const r = await safeCallAsync({
      component: "auth",
      code: "EC-AUTH-026",
      message: "revoke endpoint failed",
      context: { deviceId },
      op: async () => {
        const count = revokeAllForDevice(deviceId);
        audit({ deviceId, action: "auth.revoke", allowed: true, meta: { revokedCount: count } });
        logOp("auth", "tokens revoked", true, { deviceId, count });
        return { ok: true, revoked: count };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // GET /api/v1/audit — log de accesos del propio device
  app.get("/api/v1/audit", async (req, reply) => {
    const deviceId = req.auth?.sub;
    if (!deviceId) {
      throw E.auth("EC-AUTH-027", "Autenticación requerida", { hint: "Send Authorization header" });
    }
    const r = await safeCallAsync({
      component: "auth",
      code: "EC-AUTH-028",
      message: "audit endpoint failed",
      context: { deviceId },
      op: async () => {
        const events = getAuditForDevice(deviceId);
        logOp("auth", "audit fetched", true, { deviceId, count: events.length });
        return { deviceId, events };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}
