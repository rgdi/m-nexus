// Auth routes: register, refresh, revoke, audit.
// v0.12: JWT real con rotación de tokens.
// v0.45: error codes estructurados con AppError.
// v2.6.0: admin user login (username + password) with throttle + lockout.
//         LAN_AUTH_BYPASS env var skips auth for local network requests.

import { FastifyInstance } from "fastify";
import { registerDevice, getDevice, isDeviceRegistered, updateDeviceToken, getRegisteredDevices } from "../auth/devices.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  validateRefreshToken,
  revokeAllForDevice,
  getRefreshTokenStats,
} from "../auth/jwt.js";
import { audit, getAuditForDevice } from "../auth/audit.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logger, logOp } from "../utils/log.js";
import {
  verifyPassword,
  recordLogin,
  recordFailedLogin,
  getAdminUser,
  createAdminUser,
  isLocked,
  lockoutSecondsRemaining,
  validateCredentials,
} from "../services/users.js";
import {
  checkLoginThrottle,
  recordLoginFailure,
  recordLoginSuccess,
} from "../services/rateLimit.js";
import { isLanIp } from "../utils/network.js";

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
            hint: "Re-login to get new tokens",
          });
        }
        // Rotar: revoca el viejo y emite uno nuevo
        const newRefresh = rotateRefreshToken(body.refreshToken, rec.deviceId);
        // v2.6.0: detect scope — admin user vs legacy device.
        const isAdminUser = await getAdminUser().then((u) => u?.id === rec.deviceId).catch(() => false);
        const scope = isAdminUser ? "admin" : "device";
        const access = signAccessToken(rec.deviceId, undefined, scope);
        if (!isAdminUser) updateDeviceToken(rec.deviceId, access.jti);
        audit({ deviceId: rec.deviceId, action: "auth.refresh", allowed: true, meta: { scope } });
        logOp("auth", "token refreshed", true, { deviceId: rec.deviceId, scope });
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
    // v2.1.4: cast to any in case module augmentation didn't apply at runtime
    const deviceId = (req as any).auth?.sub ?? (req as any).deviceId;
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
        return { deviceId, entries: events };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // ────────────────────────────────────────────────────────────────────
  // v2.6.0: admin user login (username + password).
  // ────────────────────────────────────────────────────────────────────

  // POST /api/v1/auth/login
  app.post("/api/v1/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const ip = req.ip;
    const lanBypass = process.env.LAN_AUTH_BYPASS === "true" && isLanIp(ip);

    // Throttle (skip if LAN bypass)
    if (!lanBypass) {
      const t = checkLoginThrottle(ip);
      if (!t.allowed) {
        return reply.status(429).send({
          error: "Too many attempts",
          code: "EC-AUTH-101",
          retryAfterSec: t.retryAfterSec,
        });
      }
    }

    if (!body.username || !body.password) {
      return reply.status(400).send({ error: "username and password required", code: "EC-AUTH-102" });
    }

    const user = await verifyPassword(body.username, body.password);
    if (!user) {
      if (!lanBypass) recordLoginFailure(ip);
      await recordFailedLogin(body.username);
      return reply.status(401).send({ error: "Invalid credentials", code: "EC-AUTH-103" });
    }

    if (isLocked(user)) {
      return reply.status(423).send({
        error: "Account locked",
        code: "EC-AUTH-104",
        retryAfterSec: lockoutSecondsRemaining(user),
      });
    }

    if (!lanBypass) recordLoginSuccess(ip);
    await recordLogin(body.username);

    const access = signAccessToken(user.id, user.username, "admin");
    const refresh = issueRefreshToken(user.id);
    audit({ deviceId: user.id, action: "auth.login", allowed: true, meta: { username: user.username } });
    logOp("auth", `login ok: ${user.username}`, true, { userId: user.id, ip });
    return reply.send({
      accessToken: access.token,
      refreshToken: refresh.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenExpiresAt: Math.floor(refresh.expiresAt / 1000),
      username: user.username,
      lanBypass,
    });
  });

  // POST /api/v1/auth/setup — creates the admin user (only when none exists).
  app.post("/api/v1/auth/setup", async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    const existing = await getAdminUser();
    if (existing) {
      return reply.status(409).send({ error: "Admin user already exists", code: "EC-AUTH-110" });
    }
    try {
      validateCredentials(body.username ?? "", body.password ?? "");
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message, code: "EC-AUTH-111" });
    }
    const user = await createAdminUser(body.username!, body.password!);
    const access = signAccessToken(user.id, user.username, "admin");
    const refresh = issueRefreshToken(user.id);
    audit({ deviceId: user.id, action: "auth.setup", allowed: true, meta: { username: user.username } });
    logOp("auth", `admin created: ${user.username}`, true, { userId: user.id });
    return reply.send({
      accessToken: access.token,
      refreshToken: refresh.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshTokenExpiresAt: Math.floor(refresh.expiresAt / 1000),
      username: user.username,
    });
  });

  // POST /api/v1/auth/logout — clears tokens (client-side).
  app.post("/api/v1/auth/logout", async (_req, reply) => {
    // Stateless: client just deletes tokens. For future, accept refresh token to revoke server-side.
    return reply.send({ ok: true });
  });

  // GET /api/v1/auth/me — returns current user info.
  app.get("/api/v1/auth/me", async (req, reply) => {
    const auth = (req as any).auth;
    if (!auth || auth.isLanBypass) {
      return reply.send({ authenticated: false, lanBypass: !!auth?.isLanBypass });
    }
    const user = await getAdminUser();
    if (!user || user.id !== auth.sub) {
      return reply.status(401).send({ error: "Invalid token subject", code: "EC-AUTH-120" });
    }
    return reply.send({
      authenticated: true,
      username: user.username,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    });
  });

  // GET /api/v1/auth/status — public, reports setup state + LAN bypass.
  app.get("/api/v1/auth/status", async (req, reply) => {
    const ip = req.ip;
    const lanBypass = process.env.LAN_AUTH_BYPASS === "true" && isLanIp(ip);
    const admin = await getAdminUser();
    return reply.send({
      needsSetup: !admin,
      lanBypass,
      authRequired: process.env.AUTH_REQUIRED !== "false",
      activeRefreshTokens: getRefreshTokenStats().total,
    });
  });
}
