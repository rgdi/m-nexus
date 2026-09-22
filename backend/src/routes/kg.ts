/* ============================================================
 * routes/kg.ts — Knowledge Graph endpoints (v2.31.0).
 *
 *   GET  /api/v1/kg/graph                          → full graph
 *   GET  /api/v1/kg/neighbours/:id?hops=1          → ego network
 *   GET  /api/v1/kg/communities                    → community summaries
 *   GET  /api/v1/kg/search?q=...                   → search entities by label
 *   POST /api/v1/kg/rebuild                        → rebuild from corpus
 *     body: { docs: [{ id, type, title?, text }], minFreq?, maxNgram? }
 *   GET  /api/v1/kg/documents                      → list indexed documents
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { kgExtractor, type ExtractInput } from "../services/kgExtractor.js";
import { logOp } from "../utils/log.js";

export async function kgRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/kg/graph", async () => kgExtractor.getGraph());

  app.get<{ Params: { id: string }; Querystring: { hops?: string } }>(
    "/api/v1/kg/neighbours/:id",
    async (req) => kgExtractor.neighbors(req.params.id, parseInt(req.query.hops ?? "1", 10)),
  );

  app.get("/api/v1/kg/communities", async () => {
    return { communities: await kgExtractor.communities() };
  });

  app.get<{ Querystring: { q?: string } }>(
    "/api/v1/kg/search",
    async (req) => {
      const q = (req.query.q ?? "").trim().toLowerCase();
      const g = await kgExtractor.getGraph();
      if (!q) return { results: [], query: q };
      const results = g.nodes
        .filter((n) => n.label.includes(q))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 30);
      return { results, query: q };
    },
  );

  app.post<{ Body: { docs: ExtractInput[]; minFreq?: number; maxNgram?: number } }>(
    "/api/v1/kg/rebuild",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!Array.isArray(b.docs) || b.docs.length === 0) {
        return reply.code(400).send({ error: "docs array required" });
      }
      const g = await kgExtractor.rebuild(b.docs, { minFreq: b.minFreq, maxNgram: b.maxNgram });
      logOp("kg", "rebuild", true, { docs: b.docs.length, nodes: g.nodes.length, edges: g.edges.length });
      return { ok: true, nodes: g.nodes.length, edges: g.edges.length, totalFreq: g.totalFreq };
    },
  );

  app.get("/api/v1/kg/documents", async () => {
    const g = await kgExtractor.getGraph();
    return { documents: g.documents };
  });
}
