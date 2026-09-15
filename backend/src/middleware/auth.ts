// Auth middleware: valida JWT, registra dispositivo, expone user/device en req.
//
// v0.45: error codes estructurados con AppError.

import type { FastifyRequest, FastifyReply, FastifyPluginAsync } from "fastify";
import jwt from "jsonwebtoken";
import { verifyAccessToken, type AccessTokenPayload } from "../auth/jwt.js";
import { isDeviceRegistered } from "../auth/devices.js";
import { logLifecycle, logOp, logError } from "../utils/log.js";
import { AppError, E, ErrorCategory } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessTokenPayload;
    deviceId?: string;
  }
}

export const authMiddleware: (req: FastifyRequest, reply: FastifyReply) => Promise<void> = async (req, reply) => {
  // Skip si AUTH_REQUIRED está desactivado (modo dev/test)
  if (process.env.AUTH_REQUIRED === "false") return;

  // Skip si ya está en el path público
  const PUBLIC_PATHS = [
    "/health",
    "/metrics",
    "/api/v1/health",
    "/api/v1/register",
    "/api/v1/auth/refresh",
    "/api/v1/audio/transcribe",  // Whisper
    "/api/v1/llm/embed",
    "/api/v1/ocr/image",
    "/api/v1/flashcards/generate",
    "/api/v1/pdf/diff",
    "/api/v1/devices",  // GET devices (read-only)
    "/api/v1/stats",   // GET stats
    "/api/v1/secrets/test",  // Test secret
    "/api/v1/ai/embed",
    "/api/v1/ai/tutor",  // public RAG tutor
    "/api/v1/ai",         // v2.1.4: AI routes public
    // NOTE: /api/v1/auth/revoke is NOT public — it requires JWT auth
    // (handler checks req.auth.sub to know which device to revoke).
    // v2.1.4: legacy routes that the frontend uses without auth yet.
    // Tests rely on these being public too. Real auth should be enabled
    // once the frontend ships Bearer token in api.js.
    "/api/v1/flashcards",
    "/api/v1/notes",
    "/api/v1/subjects",
    "/api/v1/events",
    "/api/v1/tasks",
    "/api/v1/cross-verify",
    "/api/v1/recordings",
    "/api/v1/sync",
    "/api/v1/themes",
    "/api/v1/backup",
    "/api/v1/secrets",
    "/api/v1/upload/init",
    "/api/v1/upload/chunk",
    "/api/v1/upload/complete",
    "/api/v1/update",
    "/api/v1/rollback",
    // v2.2.0: WS sync es relay-only (no data plane). Auth opcional via WS_AUTH_REQUIRED=1.
    // Frontend usa sin Bearer (offline-first). Sin esto, conexiones WS fallan con EC-AUTH-001.
    "/ws/sync",
    // v2.3.0-B: folders CRUD — frontend usa sin Bearer (offline-first).
    "/api/v1/folders",
  ];
  const isPublic = PUBLIC_PATHS.some((p) => req.url === p || req.url.startsWith(p + "?") || req.url.startsWith(p + "/"));
  if (isPublic) return;

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return sendAuthError(reply, E.auth("EC-AUTH-001", "Missing Authorization header", {
      context: { url: req.url, requestId: req.id },
      hint: "Send 'Authorization: Bearer <token>'",
    }), 401);
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return sendAuthError(reply, E.auth("EC-AUTH-002", "Invalid Authorization header format", {
      context: { url: req.url, requestId: req.id },
      hint: "Format must be 'Bearer <token>'",
    }), 401);
  }
  const token = match[1];

  // Verify JWT
  const verifyResult = await safeCallAsync({
    component: "auth",
    code: "EC-AUTH-003",
    message: "JWT verification failed",
    context: { url: req.url, requestId: req.id, hasToken: !!token },
    op: () => Promise.resolve(verifyAccessToken(token)),
  });
  if (!verifyResult.success || !verifyResult.value) {
    return sendAuthError(reply, verifyResult.error ?? E.auth("EC-AUTH-003", "JWT verification failed"), 401);
  }
  const payload = verifyResult.value as AccessTokenPayload;
  // v2.1.4: explicitly cast to any to avoid TS module augmentation issues
  // in some bundlers (tsx/esbuild). The payload is the verified JWT.
  (req as any).auth = payload;
  if (process.env.DEBUG_AUTH === "1") console.log("[auth] sub=", payload.sub, "scope=", payload.scope);

  // Check device registration
  const deviceCheck = await safeCallAsync({
    component: "auth",
    code: "EC-AUTH-004",
    message: "Device check failed",
    context: { deviceId: payload.sub, requestId: req.id },
    op: () => Promise.resolve(isDeviceRegistered(payload.sub)),
  });
  if (!deviceCheck.success) {
    return sendAuthError(reply, deviceCheck.error ?? E.auth("EC-AUTH-004", "Device check failed"), 500);
  }
  if (!deviceCheck.value) {
    return sendAuthError(reply, E.auth("EC-AUTH-005", "Device not registered", {
      context: { deviceId: payload.sub, requestId: req.id },
      hint: "Call POST /api/v1/auth/register first",
    }), 403);
  }
  req.deviceId = payload.sub;
  // v2.1.4: explicit any cast for runtime safety
  (req as any).deviceId = payload.sub;

  logOp("auth", `auth ok for ${req.method} ${req.url}`, true, {
    deviceId: payload.sub, requestId: req.id,
  });
};

function sendAuthError(reply: FastifyReply, err: Error, statusCode: number): FastifyReply {
  const appErr = err as Error & { code?: string; category?: string; context?: unknown; hint?: string };
  logError("auth", {
    code: appErr.code ?? "EC-AUTH-001",
    category: appErr.category ?? "AUTH",
    message: err.message,
    context: appErr.context as Record<string, unknown>,
    hint: appErr.hint,
  });
  return reply.status(statusCode).send({
    error: err.message,
    code: appErr.code ?? "EC-AUTH-001",
    category: appErr.category ?? "AUTH",
    hint: appErr.hint,
  });
}
