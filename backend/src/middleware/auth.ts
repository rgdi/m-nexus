// Middleware de auth con JWT.
// v0.12: requiere Bearer token en headers Authorization.
//   - /api/v1/auth/refresh, /register, /health, /, /api/v1/devices (read), /api/v1/stats: públicos
//   - El resto: requiere JWT válido y deviceId registrado

import { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { verifyAccessToken, AccessTokenPayload } from "../auth/jwt.js";
import { audit } from "../auth/audit.js";
import { isDeviceRegistered, registerDevice, RegisteredDevice } from "../auth/devices.js";

const PUBLIC_PATHS = new Set([
  "/",
  "/metrics",
  "/api/v1/health",
  "/api/v1/register",
  "/api/v1/auth/refresh",
  "/api/v1/devices",
  "/api/v1/stats",
  "/api/v1/update", // v0.30: info pública del update
  "/api/v1/update/check", // v0.30: forzar re-check
  "/api/v1/update/apply", // v0.30: aplicar update (descarga pública)
  // v0.28: AI routes (vault eval, proposals, knowledge, quiz) son de uso
  // interno entre el plugin y el backend. La seguridad se hace a nivel de
  // red (el backend está detrás de Tailscale/VPN). Si se exponen públicamente,
  // añadir auth Bearer explícito.
  "/api/v1/ai/vault/eval",
  "/api/v1/ai/proposals/generate",
  "/api/v1/ai/cross-relevance/analyze",
  "/api/v1/ai/fsrs/review",
]);

const WS_PATHS = new Set([
  "/api/v1/audio/transcribe/stream",
]);

function isPublicPath(url: string): boolean {
  if (PUBLIC_PATHS.has(url)) return true;
  if (url.startsWith("/assets/") || url.endsWith(".html") || url.endsWith(".css") || url.endsWith(".js")) {
    return true;
  }
  // v0.28: AI routes con path params (/api/v1/ai/knowledge/:userId/..., /api/v1/ai/quiz/:userId/...)
  if (url.startsWith("/api/v1/ai/knowledge") || url.startsWith("/api/v1/ai/quiz")) return true;
  return false;
}

function isWsPath(url: string): boolean {
  // Quitar query string si existe
  const path = url.split("?")[0];
  return WS_PATHS.has(path);
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AccessTokenPayload;
  }
}

export async function authMiddleware(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (isPublicPath(req.url)) return;
  if (isWsPath(req.url)) return; // WS tiene su propia auth
  if (!config.authRequired) return;

  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    audit({ deviceId: "(unknown)", action: "auth.failed", allowed: false, meta: { reason: "no_token", url: req.url } });
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Bearer token requerido" });
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch (e) {
    audit({ deviceId: "(unknown)", action: "auth.failed", allowed: false, meta: { reason: "invalid_token" } });
    reply.code(401).send({ code: "UNAUTHORIZED", message: "Token inválido o expirado" });
    return;
  }
  if (!isDeviceRegistered(payload.sub)) {
    audit({ deviceId: payload.sub, action: "auth.failed", allowed: false, meta: { reason: "device_not_registered" } });
    reply.code(401).send({ code: "DEVICE_NOT_REGISTERED", message: "Dispositivo no registrado" });
    return;
  }
  req.auth = payload;
}

// Re-export para mantener compatibilidad
export { registerDevice, isDeviceRegistered, getRegisteredDevices } from "../auth/devices.js";
export type { RegisteredDevice } from "../auth/devices.js";
