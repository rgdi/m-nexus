// fsrsQueue routes: encolar y consultar evaluaciones FSRS REALES (v0.46).
// v0.45: error codes estructurados con AppError.
// v0.46: nuevo body schema { cards: [{ cardId, rating, currentState? }] } usando ts-fsrs.

import { FastifyInstance } from "fastify";
import { fsrsQueue, type FsrsJobCard } from "../workers/fsrsQueue.js";
import { authMiddleware } from "../middleware/auth.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export async function fsrsQueueRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // POST /api/v1/fsrs/eval
  app.post<{ Body: { userId?: string; cards?: FsrsJobCard[]; algorithm?: "fsrs-v6" | "fsrs-v5" } }>(
    "/api/v1/fsrs/eval",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "card",
        code: "EC-CARD-020",
        message: "fsrs eval enqueue failed",
        context: { cardCount: req.body?.cards?.length ?? 0 },
        op: async () => {
          const { userId, cards, algorithm } = req.body ?? {};
          if (!userId || !Array.isArray(cards) || cards.length === 0) {
            throw E.val("EC-CARD-021", "userId and cards are required", {
              context: { hasUserId: !!userId, cardCount: cards?.length ?? 0 },
              hint: "Send { userId, cards: [{ cardId: '...', rating: 1-4, currentState?: {...} }] }",
            });
          }
          if (cards.length > 10_000) {
            throw E.val("EC-CARD-022", "max 10000 cards per job", {
              context: { cardCount: cards.length, max: 10000 },
              hint: "Split into multiple jobs",
            });
          }
          // Validar ratings
          for (const c of cards) {
            if (c.rating != null && (c.rating < 1 || c.rating > 4)) {
              throw E.val("EC-CARD-028", "rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)", {
                context: { cardId: c.cardId, rating: c.rating },
                hint: "FSRS usa 4 ratings: Again/Hard/Good/Easy",
              });
            }
          }
          const id = fsrsQueue.enqueue({ userId, cards, algorithm });
          logOp("card", "fsrs enqueued", true, { jobId: id, cardCount: cards.length, algorithm: algorithm ?? "fsrs-v6" });
          return { jobId: id, queued: true };
        }
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // GET /api/v1/fsrs/job/:id
  app.get<{ Params: { id: string } }>(
    "/api/v1/fsrs/job/:id",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "card",
        code: "EC-CARD-023",
        message: "fsrs job status failed",
        context: { jobId: req.params.id },
        op: async () => {
          const status = fsrsQueue.getStatus(req.params.id);
          if (!status) {
            throw E.card("EC-CARD-024", "FSRS job not found", {
              context: { jobId: req.params.id },
              statusCode: 404,
              hint: "Job may have completed and been purged",
            });
          }
          return status;
        }
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // GET /api/v1/fsrs/stats
  app.get("/api/v1/fsrs/stats", async (req, reply) => {
    const r = await safeCallAsync({
      component: "card",
      code: "EC-CARD-025",
      message: "fsrs stats failed",
      op: async () => fsrsQueue.stats(),
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/fsrs/wait/:id
  app.post<{ Params: { id: string }; Body: { timeoutMs?: number } }>(
    "/api/v1/fsrs/wait/:id",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "card",
        code: "EC-CARD-026",
        message: "fsrs wait failed",
        context: { jobId: req.params.id, timeoutMs: req.body?.timeoutMs },
        op: async () => {
          const timeout = Math.min(req.body?.timeoutMs ?? 30_000, 60_000);
          return await fsrsQueue.waitFor(req.params.id, timeout);
        }
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // GET /api/v1/fsrs/list
  app.get("/api/v1/fsrs/list", async (req, reply) => {
    const r = await safeCallAsync({
      component: "card",
      code: "EC-CARD-027",
      message: "fsrs list failed",
      op: async () => fsrsQueue.list(),
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}
