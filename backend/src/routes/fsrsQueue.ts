// fsrsQueue routes: encolar y consultar evaluaciones FSRS async (v0.33).
//
// Endpoints:
//   POST /api/v1/fsrs/eval   → encola un job de evaluación FSRS
//   GET  /api/v1/fsrs/job/:id → status de un job
//   GET  /api/v1/fsrs/stats → métricas de la cola
//   POST /api/v1/fsrs/wait/:id → espera a que un job termine (long polling)

import { FastifyInstance } from "fastify";
import { fsrsQueue } from "../workers/fsrsQueue.js";
import { authMiddleware } from "../middleware/auth.js";

export async function fsrsQueueRoutes(app: FastifyInstance) {
  // Auth opcional (no es dato sensible, pero seguimos el patrón)
  app.addHook("preHandler", authMiddleware);

  app.post<{ Body: { userId: string; cardIds: string[]; algorithm?: "fsrs-v5" | "fsrs-v4" } }>(
    "/api/v1/fsrs/eval",
    async (req, reply) => {
      const { userId, cardIds, algorithm } = req.body ?? ({} as any);
      if (!userId || !Array.isArray(cardIds) || cardIds.length === 0) {
        return reply.code(400).send({
          code: "BAD_REQUEST",
          message: "userId and cardIds are required",
        });
      }
      if (cardIds.length > 10_000) {
        return reply.code(400).send({
          code: "TOO_MANY_CARDS",
          message: "max 10000 cards per job",
        });
      }
      const id = fsrsQueue.enqueue({ userId, cardIds, algorithm });
      return { jobId: id, queued: true };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/fsrs/job/:id",
    async (req, reply) => {
      const status = fsrsQueue.getStatus(req.params.id);
      if (!status) {
        return reply.code(404).send({ code: "JOB_NOT_FOUND" });
      }
      return status;
    }
  );

  app.get("/api/v1/fsrs/stats", async () => fsrsQueue.stats());

  app.post<{ Params: { id: string }; Body: { timeoutMs?: number } }>(
    "/api/v1/fsrs/wait/:id",
    async (req, reply) => {
      const timeout = req.body?.timeoutMs ?? 30_000;
      try {
        const result = await fsrsQueue.waitFor(req.params.id, Math.min(timeout, 60_000));
        return result;
      } catch (err) {
        return reply.code(408).send({ code: "TIMEOUT", message: (err as Error).message });
      }
    }
  );

  app.get("/api/v1/fsrs/list", async () => fsrsQueue.list());
}
