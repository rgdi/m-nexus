/* ============================================================
 * routes/smartNotifications.ts — Endpoints de notificaciones predictivas.
 *
 * v2.32.0 (note: usamos prefijo /smart-notifications para no chocar
 * con el endpoint existente /api/v1/notifications/ingest):
 *
 *   GET  /api/v1/smart-notifications?since=&unseenOnly=
 *   POST /api/v1/smart-notifications/generate
 *   POST /api/v1/smart-notifications/:id/seen
 *   GET  /api/v1/smart-notifications/unseen/count
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { smartNotifications } from "../services/smartNotifications.js";
import type { PredictableCard } from "../services/predictiveScheduler.js";
import { logOp } from "../utils/log.js";

function userFromReq(req: any): string {
  return req.headers["x-user-id"] || req.query?.userId || "demo-user";
}

export async function smartNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { since?: string; unseenOnly?: string; userId?: string } }>(
    "/api/v1/smart-notifications",
    async (req) => {
      const userId = req.query.userId ?? userFromReq(req);
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
      const all = await smartNotifications.list(userId, since);
      const unseenOnly = req.query.unseenOnly === "1";
      return { notifications: unseenOnly ? all.filter((n) => !n.seenAt) : all };
    },
  );

  app.post<{
    Body: {
      userId?: string;
      cards: PredictableCard[];
      lastStudyBySubject?: Record<string, number>;
      earlyWarnDays?: number;
      masteredThreshold?: number;
    };
  }>(
    "/api/v1/smart-notifications/generate",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!Array.isArray(b.cards)) {
        return reply.code(400).send({ error: "cards array required" });
      }
      const userId = b.userId ?? userFromReq(req);
      const fresh = await smartNotifications.generateForUser(userId, b.cards, {
        lastStudyBySubject: b.lastStudyBySubject,
        earlyWarnDays: b.earlyWarnDays,
        masteredThreshold: b.masteredThreshold,
      });
      logOp("notifications", "generate", true, { userId, fresh: fresh.length });
      return { ok: true, generated: fresh.length, notifications: fresh };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/smart-notifications/:id/seen",
    async (req, reply) => {
      const ok = await smartNotifications.markSeen(req.params.id);
      if (!ok) return reply.code(404).send({ error: "notif not found" });
      return { ok: true };
    },
  );

  app.get<{ Querystring: { userId?: string } }>(
    "/api/v1/smart-notifications/unseen/count",
    async (req) => {
      const userId = req.query.userId ?? userFromReq(req);
      return { count: await smartNotifications.unseenCount(userId) };
    },
  );
}
