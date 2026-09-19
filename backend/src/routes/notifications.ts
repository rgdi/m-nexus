// notifications.ts routes — v2.21.0
//
// REST endpoints for the notification capture pipeline.
//
//   POST /api/v1/notifications/ingest
//     Body: { notifications: CapturedNotification[] } (minus server-managed fields)
//     Returns: { inserted, deduplicated, invalid, total }
//     Required header: x-mnexus-device-id (set by native_intents.js)
//     Public path — the Android device may not have a JWT yet during
//     initial registration, and we don't want a missing token to
//     silently drop notifications.
//
//   GET /api/v1/notifications
//     Query: ?deviceId=&packageName=&limit=
//     Returns: { ok, notifications: CapturedNotification[] }
//
//   DELETE /api/v1/notifications/:id
//     Admin-only.

import type { FastifyInstance } from "fastify";
import {
  ingestNotifications,
  listNotifications,
  deleteNotification,
} from "../services/notifications.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function notificationsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/notifications/ingest", async (req, reply) => {
    const body = (req.body || {}) as { notifications?: unknown[] };
    const list = body.notifications;
    if (!Array.isArray(list)) {
      return reply.code(400).send(E.val("EC-NOT-001", "notifications must be an array", { statusCode: 400 }));
    }
    if (list.length === 0) {
      return { ok: true, inserted: 0, deduplicated: 0, invalid: 0, total: 0 };
    }
    // 500 entries per batch max — protects the in-memory cache.
    if (list.length > 500) {
      return reply.code(413).send(E.val("EC-NOT-002", "batch too large; max 500 entries", { statusCode: 413 }));
    }
    const deviceId = (req.headers["x-mnexus-device-id"] as string) || "unknown";
    const r = await ingestNotifications(deviceId, list);
    logOp("notif", "ingest", true, { deviceId, ...r });
    return { ok: true, ...r };
  });

  app.get("/notifications", async (req) => {
    const q = req.query as { deviceId?: string; packageName?: string; limit?: string };
    const limit = q.limit ? parseInt(q.limit, 10) : 100;
    const items = await listNotifications({
      deviceId: q.deviceId,
      packageName: q.packageName,
      limit,
    });
    return { ok: true, notifications: items, count: items.length };
  });

  app.delete<{ Params: { id: string } }>("/notifications/:id", async (req, reply) => {
    const ok = await deleteNotification(req.params.id);
    if (!ok) return reply.code(404).send(E.val("EC-NOT-003", "notification not found", { statusCode: 404 }));
    return { ok: true, deleted: req.params.id };
  });
}
