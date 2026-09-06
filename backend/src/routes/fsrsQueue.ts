// fsrsQueue routes: encolar y consultar evaluaciones FSRS async (v0.33).
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { fsrsQueue } from "../workers/fsrsQueue.js";
import { authMiddleware } from "../middleware/auth.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export async function fsrsQueueRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authMiddleware);

  // POST /api/v1/fsrs/eval
  app.post<{ Body: { userId?: string; cardIds?: string[]; algorithm?: "fsrs-v5" | "fsrs-v4" } }>(
    "/api/v1/fsrs/eval",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "card",
        code: "EC-CARD-020",
        message: "fsrs eval enqueue failed",
        context: { cardCount: req.body?.cardIds?.length ?? 0 },
        op: async () => {
          const { userId, cardIds, algorithm } = req.body ?? {};
          if (!userId || !Array.isArray(cardIds) || cardIds.length === 0) {
            throw E.val("EC-CARD-021", "userId and cardIds are required", {
              context: { hasUserId: !!userId, cardCount: cardIds?.length ?? 0 },
              hint: "Send { userId, cardIds: ['...', '...'] }",
            });
          }
          if (cardIds.length > 10_000) {
            throw E.val("EC-CARD-022", "max 10000 cards per job", {
              context: { cardCount: cardIds.length, max: 10000 },
              hint: "Split into multiple jobs",
            });
          }
          const id = fsrsQueue.enqueue({ userId, cardIds, algorithm });
          logOp("card", "fsrs enqueued", true, { jobId: id, cardCount: cardIds.length });
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
