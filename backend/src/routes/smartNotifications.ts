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

  // v2.38.0: the bell polls this for its badge. It did not exist, so
  // the fetch 404'd, the catch swallowed it, and the badge never lit up
  // — the v2.34.1 "polished notification bell" shipped permanently
  // showing zero.
  app.get("/api/v1/notifications-smart/unseen/count", async () => {
    const pending = await smartNotifications.getPending();
    return { count: pending.length };
  });

  // v2.38.0: the bell's "mark all read" button posted to a path that did
  // not exist either — a 404 hidden behind the same empty catch.
  app.post("/api/v1/notifications-smart/mark-all-read", async () => {
    const pending = await smartNotifications.getPending();
    let n = 0;
    for (const item of pending) {
      if (await smartNotifications.markRead(item.id)) n++;
    }
    return { marked: n };
  });

  app.post("/api/v1/notifications-smart/clear", async () => {
    await smartNotifications.clearAll();
    return { cleared: true };
  });

  // v2.38.0: alias under the prefix the client actually uses. Every other
  // route here is /notifications-smart, but the bell has always called
  // /smart-notifications — the two were never the same path, so the bell
  // was talking to nothing.
  app.get("/api/v1/smart-notifications", async () => {
    const pending = await smartNotifications.getPending();
    return { notifications: pending };
  });
  app.get("/api/v1/smart-notifications/unseen/count", async () => {
    const pending = await smartNotifications.getPending();
    return { count: pending.length };
  });
  app.post("/api/v1/smart-notifications/mark-all-read", async () => {
    const pending = await smartNotifications.getPending();
    let n = 0;
    for (const item of pending) if (await smartNotifications.markRead(item.id)) n++;
    return { marked: n };
  });
}
