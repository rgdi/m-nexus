/* ============================================================
 * routes/multiBoard.ts — Multi-board endpoints.
 *
 * v2.32.0:
 *   GET    /api/v1/boards                      → list
 *   POST   /api/v1/boards                      → create { name, subject, color?, icon? }
 *   PATCH  /api/v1/boards/:id                  → update
 *   DELETE /api/v1/boards/:id                  → remove
 *   POST   /api/v1/boards/diagnose             → cross-board scan + persist links
 *   GET    /api/v1/boards/recommendations     → top 10 cross-board recs
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { multiBoard } from "../services/multiBoard.js";
import type { FlashcardLite } from "../services/multiBoard.js";

export async function multiBoardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/boards", async () => ({ boards: await multiBoard.listBoards() }));

  app.post<{ Body: { name: string; subject: string; color?: string; icon?: string } }>(
    "/api/v1/boards",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.name || !b.subject) {
        return reply.code(400).send({ error: "name and subject required" });
      }
      return await multiBoard.createBoard(b);
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<{ name: string; subject: string; color: string; icon: string }> }>(
    "/api/v1/boards/:id",
    async (req, reply) => {
      const u = await multiBoard.updateBoard(req.params.id, req.body ?? {});
      if (!u) return reply.code(404).send({ error: "board not found" });
      return u;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/boards/:id",
    async (req, reply) => {
      const ok = await multiBoard.deleteBoard(req.params.id);
      if (!ok) return reply.code(404).send({ error: "board not found" });
      return { deleted: true };
    },
  );

  app.post<{ Body: { cards?: FlashcardLite[] } }>(
    "/api/v1/boards/diagnose",
    async (req) => multiBoard.diagnose({ cards: req.body?.cards }),
  );

  app.get("/api/v1/boards/recommendations", async () => ({
    recommendations: await multiBoard.recommendCrossBoard(),
  }));
}
