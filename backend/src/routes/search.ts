// search.ts: HTTP route para search full-text (Fase 2.A).
//
// GET /api/v1/search?q=...&tags=...&limit=...
//   q: query string
//   tags: comma-separated
//   limit: max results (default 50)
//
// Body de respuesta: { results: SearchResult[], total, query, fts5 }

import { FastifyInstance } from "fastify";
import { SearchService, type SearchResult } from "../services/searchService";
import { authMiddleware } from "../middleware/auth.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";
import * as path from "node:path";

let serviceInstance: SearchService | null = null;

function getService(): SearchService {
  if (!serviceInstance) {
    const dbPath = process.env.SEARCH_DB_PATH ?? path.join(process.cwd(), ".mnexus-search.db");
    serviceInstance = new SearchService(dbPath);
  }
  return serviceInstance;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authMiddleware);

  // GET /api/v1/search?q=...
  app.get<{ Querystring: { q?: string; tags?: string; limit?: string } }>(
    "/search",
    async (req) => {
      const r = await safeCallAsync({
        component: "search",
        code: "EC-SEARCH-010",
        message: "search failed",
        context: { query: req.query?.q, tags: req.query?.tags },
        op: async () => {
          const q = req.query?.q?.trim();
          if (!q) {
            throw E.val("EC-SEARCH-011", "query parameter 'q' is required", {
              context: { receivedQuery: req.query?.q },
            });
          }
          const limit = Math.min(parseInt(req.query?.limit ?? "50", 10) || 50, 200);
          const tags = req.query?.tags?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
          const start = Date.now();
          const results = getService().search(q, { limit, tags });
          const durationMs = Date.now() - start;
          logOp("search", "search", true, { query: q, resultCount: results.length, durationMs, fts5: getService().stats().fts5 });
          return {
            query: q,
            total: results.length,
            durationMs,
            fts5: getService().stats().fts5,
            results,
          };
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // POST /api/v1/search/index - indexar nota(s)
  app.post<{ Body: { notes: Array<{ path: string; title: string; content: string; tags?: string[]; modified: number }> } }>(
    "/search/index",
    async (req) => {
      const r = await safeCallAsync({
        component: "search",
        code: "EC-SEARCH-012",
        message: "index failed",
        context: { noteCount: req.body?.notes?.length ?? 0 },
        op: async () => {
          if (!Array.isArray(req.body?.notes) || req.body.notes.length === 0) {
            throw E.val("EC-SEARCH-013", "notes array is required", {
              context: { bodyKeys: Object.keys(req.body ?? {}) },
            });
          }
          const inserted = getService().indexNotes(req.body.notes);
          logOp("search", "index", true, { count: inserted });
          return { indexed: inserted, total: getService().count() };
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // GET /api/v1/search/stats
  app.get("/search/stats", async () => {
    return getService().stats();
  });
}
