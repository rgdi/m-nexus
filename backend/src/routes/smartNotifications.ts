/* ============================================================
 * routes/smartNotifications.ts — Smart notifications endpoints (v2.32.0).
 *
 *   POST /api/v1/notifications/generate
 *     body: { cards: PredictableCard[], targetRetention?, horizonDays? }
 *     → { notifications, generatedAt }
 *
 *   GET  /api/v1/notifications              → pending notifications
 *   GET  /api/v1/notifications/all          → full store (pending + history)
 *   POST /api/v1/notifications/:id/read     → mark as read
 *   POST /api/v1/notifications/:id/dismiss  → dismiss + archive
 *   POST /api/v1/notifications/clear        → clear all
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import {
  smartNotifications,
  type Notification,
} from "../services/smartNotifications.js";
import type { PredictableCard } from "../services/predictiveScheduler.js";

export async function smartNotificationsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      cards: Array<{ id: string } & Record<string, any>>;
      targetRetention?: number;
      horizonDays?: number;
    };
  }>(
    "/api/v1/notifications-smart/generate",
    async (req) => {
      const b = req.body ?? ({} as any);
      const cards: PredictableCard[] = (b.cards ?? []).map((c: any) => ({
        id: c.id,
        card: {
          stability: c.stability ?? 0.5,
          difficulty: c.difficulty ?? 5,
          elapsed: c.elapsed ?? 0,
          reps: c.reps ?? 0,
          lapses: c.lapses ?? 0,
          state: c.state ?? "new",
          lastReview: c.lastReview ?? 0,
          due: c.due ?? 0,
        },
      }));
      const notifications = await smartNotifications.generate({
        cards,
        targetRetention: b.targetRetention,
        horizonDays: b.horizonDays,
      });
      return { notifications, generatedAt: Date.now() };
    },
  );

  app.get("/api/v1/notifications-smart", async () => {
    const pending = await smartNotifications.getPending();
    return { notifications: pending };
  });

  app.get("/api/v1/notifications-smart/all", async () => smartNotifications.getAll());

  app.post<{ Params: { id: string } }>(
    "/api/v1/notifications-smart/:id/read",
    async (req, reply) => {
      const ok = await smartNotifications.markRead(req.params.id);
      if (!ok) return reply.code(404).send({ error: "Notification not found" });
      return { marked: true };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/v1/notifications-smart/:id/dismiss",
    async (req, reply) => {
      const ok = await smartNotifications.dismiss(req.params.id);
      if (!ok) return reply.code(404).send({ error: "Notification not found" });
      return { dismissed: true };
    },
  );

  app.post("/api/v1/notifications-smart/clear", async () => {
    await smartNotifications.clearAll();
    return { cleared: true };
  });
}
