// marketplaceReal.ts: rutas del marketplace real (v0.60 P1.11).
//
// Endpoints:
//   GET    /api/v1/marketplace/decks                  - listar (filtros)
//   GET    /api/v1/marketplace/decks/:id              - detalle
//   GET    /api/v1/marketplace/decks/:id/reviews      - reviews
//   POST   /api/v1/marketplace/decks/:id/reviews      - nueva review
//   POST   /api/v1/marketplace/decks/:id/install      - instalar
//   GET    /api/v1/marketplace/installs               - mis installs
//   GET    /api/v1/marketplace/decks/:id/download     - descargar deck
//   GET    /api/v1/marketplace/stats                  - stats

import { FastifyInstance } from "fastify";
import { getMarketplaceRealService, type Review } from "../services/marketplaceRealService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function marketplaceRealRoutes(app: FastifyInstance): Promise<void> {
  const svc = getMarketplaceRealService();

  // v0.60: listar decks
  app.get<{ Querystring: { category?: string; language?: string; search?: string; official?: string } }>(
    "/marketplace/decks",
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

  // v0.60: detalle de deck
  app.get<{ Params: { id: string } }>(
    "/marketplace/decks/:id",
    async (req) => {
      const deck = svc.getDeck(req.params.id);
      if (!deck) throw E.val("EC-MKT-001", "Deck no encontrado", {
        context: { id: req.params.id }, statusCode: 404,
      });
      const versions = svc.getVersions(req.params.id);
      const latest = versions[versions.length - 1];
      return { deck, versions, latestVersion: latest };
    },
  );

  // v0.60: reviews
  app.get<{ Params: { id: string } }>(
    "/marketplace/decks/:id/reviews",
    async (req) => {
      return { reviews: svc.getReviews(req.params.id) };
    },
  );

  // v0.60: nueva review
  app.post<{
    Params: { id: string };
    Body: { userId?: string; userName?: string; rating?: number; comment?: string };
  }>(
    "/marketplace/decks/:id/reviews",
    async (req, reply) => {
      const { userId = "anon", userName = "anon", rating, comment } = req.body ?? {};
      if (rating == null || rating < 1 || rating > 5) {
        throw E.val("EC-MKT-002", "rating debe estar entre 1 y 5", { context: { rating } });
      }
      const review = svc.addReview({
        deckId: req.params.id,
        userId, userName, rating,
        comment: comment ?? "",
      });
      reply.code(201);
      logOp("marketplace", "review added", true, { deckId: req.params.id, rating });
      return review;
    },
  );

  // v0.60: install
  app.post<{ Params: { id: string }; Body: { userId?: string; subscribed?: boolean } }>(
    "/marketplace/decks/:id/install",
    async (req) => {
      const { userId = "anon", subscribed = true } = req.body ?? {};
      const install = svc.install(userId, req.params.id, subscribed);
      if (!install) throw E.val("EC-MKT-003", "Deck no encontrado", {
        context: { id: req.params.id }, statusCode: 404,
      });
      logOp("marketplace", "installed", true, { deckId: req.params.id, userId });
      return install;
    },
  );

  // v0.60: mis installs
  app.get<{ Querystring: { userId?: string } }>(
    "/marketplace/installs",
    async (req) => {
      const userId = req.query.userId ?? "anon";
      const list = svc.getUserInstalls(userId);
      return { installs: list, count: list.length };
    },
  );

  // v0.60: descargar deck (v0.60: stub que devuelve metadata)
  app.get<{ Params: { id: string } }>(
    "/marketplace/decks/:id/download",
    async (req) => {
      const deck = svc.getDeck(req.params.id);
      if (!deck) throw E.val("EC-MKT-004", "Deck no encontrado", {
        context: { id: req.params.id }, statusCode: 404,
      });
      const latest = svc.getLatestVersion(req.params.id);
      logOp("marketplace", "download requested", true, { deckId: req.params.id, version: latest?.version });
      return {
        deckId: req.params.id,
        version: latest?.version,
        cardCount: latest?.cardCount,
        sizeBytes: latest?.sizeBytes,
        // v0.60: en produccion, devolveria un .apkg real
        downloadUrl: latest?.apkgUrl,
        message: "v0.60: download es stub. El .apkg real se generara en v0.61",
      };
    },
  );

  // v0.60: stats
  app.get("/marketplace/stats", async () => svc.stats());
}
