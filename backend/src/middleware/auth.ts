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
import { isLanIp } from "../utils/network.js";

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
    "/api/v1/devices/register",  // v2.19.0: App-side device registration
    "/api/v1/devices",          // v2.19.0: PATCH permissions/preferences/heartbeat
    "/api/v1/sync/replay",      // v2.19.0: offline queue replay
    "/api/v1/notifications/ingest",  // v2.21.0: notif listener ingest (device may have no JWT)
    "/api/v1/cluster/peers",          // v2.23.3: peer registry (informational)
    "/api/v1/cluster/leader",         // v2.23.3: who is the leader
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
    //
    // v2.37.0: removed "/api/v1/flashcards" and "/api/v1/notes" from this
    // list. Both return the entire store — every card with its answer
    // key, every note body — to any anonymous caller. services/api.js has
    // attached the Bearer token since v2.6.0, so the app does not need
    // the exemption. Screens still doing a bare fetch for these are
    // listed in docs/v2.37.md and must move to api.js.
    "/api/v1/subjects",
    "/api/v1/events",
    // v2.38.0: "/api/v1/tasks" REMOVED. It is the capture inbox — it now
    // holds grocery lists, habits and expense entries, which is about as
    // personal as this app gets.
    "/api/v1/print-defaults",   // v2.33.1: built-in defaults (no user data)
    "/api/v1/progress/heatmap", // v2.35.0: read-only progress analytics
    "/api/v1/progress/stats",
    "/api/v1/progress/series",
    "/api/v1/progress/retention",
    "/api/v1/progress/breakdown",
    "/api/v1/grade/typed",     // v2.36.0: deterministic grader, no user data
    "/api/v1/grade/mcq",       // v2.36.0: re-reads the card server-side
    "/api/v1/cross-verify",
    "/api/v1/recordings",
    "/api/v1/sync",
    "/api/v1/themes",
    "/api/v1/backup",
    "/api/v1/secrets",
    "/api/v1/upload/init",
    "/api/v1/upload/chunk",
    "/api/v1/upload/complete",
    // v2.16.0: user-uploaded .glb models (import anatomical assets).
    "/api/v1/models",
    "/api/v1/update",
    "/api/v1/rollback",
    // v2.2.0: WS sync es relay-only (no data plane). Auth opcional via WS_AUTH_REQUIRED=1.
    // Frontend usa sin Bearer (offline-first). Sin esto, conexiones WS fallan con EC-AUTH-001.
    "/ws/sync",
    // v2.3.0-B: folders CRUD — frontend usa sin Bearer (offline-first).
    "/api/v1/folders",
    // v2.6.0: flashcards CRUD — used by side panel Cards tab.
    // v2.37.0: REMOVED. A second copy of this entry lived further down the
    // list and re-granted the exemption after the first one was taken
    // out, so GET /api/v1/flashcards kept answering anonymous callers
    // with every correctIndex in the store. The `notes` equivalent had
    // only one entry and was genuinely closed.
    // v2.8.0: study planner + image occlusion (used offline-first by side panel + scheduler)
    "/api/v1/study",
    "/api/v1/occlusion",
    // v2.14.0: static asset paths (3D models, images) served by @fastify/static
    "/models",
    "/public",
    // v2.6.0: admin login/setup/status — must be public so you can actually log in.
    "/api/v1/auth/login",
    "/api/v1/auth/setup",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/auth/status",
    // v2.25.0: block backlinks + query (used offline-first by editor)
    "/api/v1/blocks",
    "/api/v1/notes/query",
    // v2.26.0: daily journal (used offline-first by journal screen + widgets)
    "/api/v1/journal",
    // v2.27.0: Anki .apkg import/export (used offline-first by file import widget)
    "/api/v1/anki",
    // v2.28.0: PDF highlights + atomic card creation (used offline-first by PDF viewer)
    "/api/v1/pdf",
    // v2.29.0: CRDT sync of PDF entities across devices (state, update, log, devices, stats)
    "/api/v1/sync/pdf",
    // v2.30.0: FSRS-7 predictive endpoints (predict, optimal-window, risk-heatmap, calibrate)
    "/api/v1/fsrs/predict",
    "/api/v1/fsrs/optimal-window",
    "/api/v1/fsrs/risk-heatmap",
    "/api/v1/fsrs/calibrate",
    "/api/v1/fsrs/calibration",
    // v2.31.0: Knowledge Graph endpoints (extraction, search, neighbours, communities)
    "/api/v1/kg",
    // v2.32.0: OCR + handwriting recognition endpoints
    "/api/v1/ocr",
    // v2.32.0: Multi-board spaced repetition
    "/api/v1/boards",
    // v2.32.0: Smart retention-predictive notifications
    "/api/v1/notifications-smart",
    // v2.32.0: Smart Notifications + OCR/HTR + Multi-board
    "/api/v1/smart-notifications",
    "/api/v1/ocr-v2",
    "/api/v1/htr",
    "/api/v1/boards",
  ];
  const isPublic = PUBLIC_PATHS.some((p) => req.url === p || req.url.startsWith(p + "?") || req.url.startsWith(p + "/"));
  if (isPublic) {
    // v2.37.0 — optional auth on public paths.
    //
    // Returning here used to leave `req.auth` undefined for every public
    // route, which made it impossible for a public endpoint to offer a
    // richer response to a signed-in caller. POST /api/v1/grade/mcq needs
    // exactly that: the inline-options preview works for anyone, but
    // looking a card up by id is limited to the owner.
    //
    // If a token is present, verify it and populate req.auth. If it is
    // absent, malformed or expired, fall through as anonymous rather
    // than rejecting — the route's own gate decides what that means.
    if (req.headers.authorization) {
      try {
        const optMatch = req.headers.authorization.match(/^Bearer\s+(.+)$/i);
        if (optMatch) {
          const v = await safeCallAsync({
            component: "auth",
            code: "EC-AUTH-003",
            message: "JWT verification failed",
            op: () => Promise.resolve(verifyAccessToken(optMatch[1])),
          });
          if (v.success && v.value) {
            (req as any).auth = v.value;
          }
        }
      } catch {
        // Anonymous is a valid state for a public route.
      }
    }
    return;
  }

  // v2.6.0: LAN bypass — skip auth for requests from local network.
  if (process.env.LAN_AUTH_BYPASS === "true" && isLanIp(req.ip)) {
    (req as any).auth = { sub: "lan-bypass", scope: "all", isLanBypass: true };
    logOp("auth", "lan bypass applied", true, { ip: req.ip, url: req.url });
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
  const payload = verifyResult.value as AccessTokenPayload;
  // v2.1.4: explicitly cast to any to avoid TS module augmentation issues
  // in some bundlers (tsx/esbuild). The payload is the verified JWT.
  (req as any).auth = payload;
  if (process.env.DEBUG_AUTH === "1") console.log("[auth] sub=", payload.sub, "scope=", payload.scope);

  // v2.6.0: admin tokens (scope: "admin") skip device registration check.
  // The old device flow (scope: "device") still requires register.
  if (payload.scope === "admin") {
    req.deviceId = payload.sub;
    (req as any).deviceId = payload.sub;
    logOp("auth", `admin auth ok for ${req.method} ${req.url}`, true, { userId: payload.sub });
    return;
  }

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
