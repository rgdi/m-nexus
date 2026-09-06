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
  // Skip si ya está en el path público
  if (req.url.startsWith("/health") || req.url.startsWith("/metrics") || req.url === "/") {
    return;
  }

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
  const payload = verifyResult.value;
  req.auth = payload;

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

  logOp("auth", `auth ok for ${req.method} ${req.url}`, true, {
    deviceId: payload.sub, requestId: req.id,
  });
};

function sendAuthError(reply: FastifyReply, err: AppError, statusCode: number): FastifyReply {
  logError("auth", {
    code: err.code,
    category: err.category,
    message: err.message,
    context: err.context,
    hint: err.hint,
  });
  return reply.status(statusCode).send({
    error: err.message,
    code: err.code,
    category: err.category,
    hint: err.hint,
  });
}
