/* ============================================================
 * routes/multiBoard.ts — Multi-board endpoints (v2.32.0).
 *
 *   GET    /api/v1/boards                  → list decks
 *   POST   /api/v1/boards                  → create deck { name, color, description }
 *   GET    /api/v1/boards/:id              → get deck
 *   PATCH  /api/v1/boards/:id              → update deck
 *   DELETE /api/v1/boards/:id              → delete deck
 *   POST   /api/v1/boards/:id/calibrate    → per-deck calibration
 *   POST   /api/v1/boards/:id/cards/:cardId   → assign card to deck
 *   DELETE /api/v1/boards/:id/cards/:cardId   → unassign card
 *   GET    /api/v1/boards/:id/cards        → cards in this deck
 *   GET    /api/v1/cards/:cardId/boards    → boards containing this card
 *   POST   /api/v1/boards/diagnostic        → run cross-deck diagnostic
 *   GET    /api/v1/boards/diagnostics       → list past diagnostics
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { multiBoard } from "../services/multiBoard.js";
import { calibrate, calibrationStore } from "../services/fsrs7.js";
import { logOp } from "../utils/log.js";

export async function multiBoardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/boards", async () => ({ boards: await multiBoard.listDecks() }));

  app.post<{ Body: { name: string; color?: string; description?: string } }>(
    "/api/v1/boards",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.name) return reply.code(400).send({ error: "name required" });
      const deck = await multiBoard.createDeck(b);
      reply.code(201);
      return deck;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/boards/:id",
    async (req, reply) => {
      const deck = await multiBoard.getDeck(req.params.id);
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      return deck;
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; color?: string; description?: string } }>(
    "/api/v1/boards/:id",
    async (req, reply) => {
      const updated = await multiBoard.updateDeck(req.params.id, req.body ?? {});
      if (!updated) return reply.code(404).send({ error: "Deck not found" });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/boards/:id",
    async (req, reply) => {
      const ok = await multiBoard.deleteDeck(req.params.id);
      if (!ok) return reply.code(404).send({ error: "Deck not found" });
      return { deleted: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { history: any[] } }>(
    "/api/v1/boards/:id/calibrate",
    async (req, reply) => {
      const deck = await multiBoard.getDeck(req.params.id);
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      const cal = calibrate(req.body?.history ?? []);
      calibrationStore.set(req.params.id, cal);
      const updated = await multiBoard.updateDeck(req.params.id, { calibration: cal });
      logOp("decks", "calibrate", true, { deckId: req.params.id, sampleSize: cal.sampleSize });
      return { deck: updated, calibration: cal };
    },
  );

  app.post<{ Params: { id: string; cardId: string } }>(
    "/api/v1/boards/:id/cards/:cardId",
    async (req, reply) => {
      const deck = await multiBoard.getDeck(req.params.id);
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      const link = await multiBoard.assignCard(req.params.cardId, req.params.id);
      reply.code(201);
      return link;
    },
  );

  app.delete<{ Params: { id: string; cardId: string } }>(
    "/api/v1/boards/:id/cards/:cardId",
    async (req, reply) => {
      const ok = await multiBoard.unassignCard(req.params.cardId, req.params.id);
      if (!ok) return reply.code(404).send({ error: "Link not found" });
      return { deleted: true };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/v1/boards/:id/cards",
    async (req, reply) => {
      const deck = await multiBoard.getDeck(req.params.id);
      if (!deck) return reply.code(404).send({ error: "Deck not found" });
      const cards = await multiBoard.getDeckCards(req.params.id);
      return { deckId: req.params.id, cards };
    },
  );

  app.get<{ Params: { cardId: string } }>(
    "/api/v1/cards/:cardId/boards",
    async (req) => {
      const boards = await multiBoard.getCardDecks(req.params.cardId);
      return { cardId: req.params.cardId, boards };
    },
  );

  app.post<{ Body: { cardStates?: Array<{ cardId: string; stability: number; difficulty: number; state: string; lastReview: number; due: number }> } }>(
    "/api/v1/boards/diagnostic",
    async (req) => {
      const b = req.body ?? {};
      const stateMap = new Map<string, any>();
      for (const s of b.cardStates ?? []) {
        stateMap.set(s.cardId, s);
      }
      return multiBoard.diagnostic(stateMap);
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/api/v1/boards/diagnostics",
    async (req) => {
      const limit = parseInt(req.query.limit ?? "10", 10);
      return { diagnostics: await multiBoard.listDiagnostics(limit) };
    },
  );
}
