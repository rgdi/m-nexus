// marketplaceSqlite.ts: rutas REST del marketplace con SQLite (v0.61.0).
//
// Reemplaza las rutas in-memory de v0.60. Persistencia real.

import { FastifyInstance } from "fastify";
import { getMarketplaceSqliteService, type ReviewRow } from "../services/marketplaceSqliteService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function marketplaceSqliteRoutes(app: FastifyInstance): Promise<void> {
  const svc = getMarketplaceSqliteService();

  app.get<{ Querystring: { category?: string; language?: string; search?: string; official?: string } }>(
    "/marketplace-v2/decks",
    async (req) => {
      const q = req.query;
      const list = svc.listDecks({
        category: q.category,
        language: q.language,
        search: q.search,
        official: q.official ? q.official === "true" : undefined,
      });
      return { decks: list, total: list.length };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/marketplace-v2/decks/:id",
    async (req) => {
      const deck = svc.getDeck(req.params.id);
      if (!deck) throw E.val("EC-MK2-001", "Deck no encontrado",
        { context: { id: req.params.id }, statusCode: 404 });
      const versions = svc.getVersions(req.params.id);
      return { deck, versions, latestVersion: versions[versions.length - 1] };
    },
  );

  app.post<{
    Body: { id?: string; name: string; description?: string; author_id: string; author_name: string;
      tags?: string[]; card_count?: number; language?: string; category?: string; price_cents?: number };
  }>("/marketplace-v2/decks", async (req, reply) => {
    const b = req.body ?? {} as any;
    if (!b.name || !b.author_id) {
      throw E.val("EC-MK2-002", "name y author_id requeridos", { context: { body: b } });
    }
    const id = b.id ?? `deck-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const created = svc.createDeck({
      id, name: b.name,
      description: b.description ?? "",
      author_id: b.author_id, author_name: b.author_name ?? b.author_id,
      tags: JSON.stringify(b.tags ?? []),
      card_count: b.card_count ?? 0,
      language: b.language ?? "en",
      category: b.category ?? "general",
      official: 0,
      price_cents: b.price_cents ?? 0,
    });
    reply.code(201);
    logOp("marketplace-v2", "deck created", true, { id: created.id });
    return created;
  });

  app.get<{ Params: { id: string } }>(
    "/marketplace-v2/decks/:id/reviews",
    async (req) => ({ reviews: svc.getReviews(req.params.id) }),
  );

  app.post<{ Params: { id: string }; Body: { userId?: string; userName?: string; rating: number; comment?: string } }>(
    "/marketplace-v2/decks/:id/reviews",
    async (req, reply) => {
      const b = req.body ?? {} as any;
      if (b.rating == null || b.rating < 1 || b.rating > 5) {
        throw E.val("EC-MK2-003", "rating debe estar entre 1 y 5", { context: { rating: b.rating } });
      }
      const r: ReviewRow = {
        id: "",
        deck_id: req.params.id,
        user_id: b.userId ?? "anon",
        user_name: b.userName ?? "anon",
        rating: b.rating,
        comment: b.comment ?? "",
        created_at: 0,
      };
      const created = svc.addReview(r);
      reply.code(201);
      logOp("marketplace-v2", "review added", true, { deckId: req.params.id, rating: b.rating });
      return created;
    },
  );

  app.post<{ Params: { id: string }; Body: { userId?: string; subscribed?: boolean } }>(
    "/marketplace-v2/decks/:id/install",
    async (req) => {
      const b = req.body ?? {} as any;
      const i = svc.install(b.userId ?? "anon", req.params.id, b.subscribed !== false);
      if (!i) throw E.val("EC-MK2-004", "Deck no encontrado",
        { context: { id: req.params.id }, statusCode: 404 });
      return i;
    },
  );

  app.get<{ Querystring: { userId?: string } }>(
    "/marketplace-v2/installs",
    async (req) => {
      const list = svc.getUserInstalls(req.query.userId ?? "anon");
      return { installs: list, count: list.length };
    },
  );

  app.get("/marketplace-v2/stats", async () => svc.stats());

  /// v0.61.0: instalacion batch (varios decks a la vez).
  app.post<{ Body: { userId?: string; deckIds: string[] } }>(
    "/marketplace-v2/install-batch",
    async (req) => {
      const b = req.body ?? {} as any;
      const results = (b.deckIds ?? []).map((id: string) => {
        const i = svc.install(b.userId ?? "anon", id, true);
        return { deckId: id, ok: !!i, version: i?.version };
      });
      return { results, count: results.filter((r: any) => r.ok).length };
    },
  );
}
