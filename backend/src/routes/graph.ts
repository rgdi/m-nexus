// routes/graph.ts — el índice único y el estudio exclusivo.
//
// v2.38.10
//
//   GET  /api/v1/graph              reconstruye y devuelve el grafo
//   GET  /api/v1/graph/search?q=    busca en todo, no en una pantalla
//   GET  /api/v1/graph/scope/:id    qué material hay bajo un recurso
//   POST /api/v1/graph/scope        estudio exclusivo de un tema
//   GET  /api/v1/graph/stale        lo que lleva tiempo sin tocarse
//   POST /api/v1/graph/resolve      de un id a la URL de apertura
//
// "Estudio exclusivo" no es un filtro de la interfaz: es un conjunto de
// ids que la cola de estudio acepta tal cual. El frontend no decide qué
// se estudia; pide un alcance y lo que viene lo estudia.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { currentSubject } from "../services/userStore.js";
import {
  buildGraph, saveGraph, loadGraph, relatedTo, scopeOf, search, reindexChanged,
  type ResourceGraph, type ResourceKind,
} from "../services/resourceGraph.js";
import { logOp } from "../utils/log.js";

const KINDS: ResourceKind[] = ["note", "flashcard", "occlusion", "document", "recording", "event", "task"];

/** Cuánto tarda en construirse, y si conviene cachearlo. */
const GRAPH_TTL_MS = 30_000;

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  const sub = (_req: FastifyRequest) => currentSubject();

  async function ensure(sub_: string, force = false): Promise<{ g: ResourceGraph; changed: { added: string[]; changed: string[]; removed: string[]; ms: number }; ms: number }> {
    const t0 = Date.now();
    const prev = force ? null : await loadGraph(sub_);
    if (prev && !force && Date.now() - prev.builtAt < GRAPH_TTL_MS) {
      return { g: prev, changed: { added: [], changed: [], removed: [], ms: 0 }, ms: Date.now() - t0 };
    }
    const g = await buildGraph(sub_);
    const changed = await reindexChanged(sub_, prev, g);
    await saveGraph(sub_, g);
    logOp("graph", "build", true, {
      sub: sub_.slice(0, 8), resources: g.resources.length, edges: g.edges.length,
      added: changed.added.length, modified: changed.changed.length, removed: changed.removed.length,
      ms: Date.now() - t0,
    });
    return { g, changed, ms: Date.now() - t0 };
  }

  app.get<{ Querystring: { force?: string } }>("/api/v1/graph", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const { g, changed, ms } = await ensure(s, req.query.force === "1");
    return {
      version: g.version,
      builtAt: g.builtAt,
      ms,
      incremental: changed,
      stats: g.stats,
      resources: g.resources.map((r) => ({
        id: r.id, kind: r.kind, title: r.title, words: r.words,
        folderId: r.folderId, source: r.source,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
        lastTouchedAt: r.lastTouchedAt, touches: r.touches,
      })),
      edges: g.edges,
    };
  });

  app.get<{ Querystring: { q?: string; limit?: string; kind?: string } }>(
    "/api/v1/graph/search",
    async (req, reply) => {
      const s = sub(req);
      if (!s) return reply.code(401).send({ error: "unauthorized" });
      const q = (req.query.q || "").trim();
      if (!q) return { hits: [] };
      const { g } = await ensure(s);
      const kind = KINDS.includes(req.query.kind as ResourceKind) ? (req.query.kind as ResourceKind) : null;
      let hits = search(g, q, Number(req.query.limit) || 30);
      if (kind) hits = hits.filter((r) => r.kind === kind);
      return { hits };
    },
  );

  /** Qué hay bajo un recurso: la pregunta de "estudio solo esto". */
  app.get<{ Params: { id: string } }>("/api/v1/graph/scope/:id", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const { g } = await ensure(s);
    const id = decodeURIComponent(req.params.id);
    const res = g.resources.find((r) => r.id === id);
    if (!res) return reply.code(404).send({ error: "not_in_graph", id });
    const scope = scopeOf(g, id);
    return {
      id,
      kind: res.kind,
      title: res.title,
      mode: scope.mode,
      label: scope.label,
      ids: [...scope.ids],
      related: relatedTo(g, id).map((r) => ({ id: r.id, kind: r.kind, title: r.title, words: r.words })),
    };
  });

  /**
   * Estudio exclusivo. Devuelve el alcance Y la cola que resulta, para
   * que el frontend no tenga que componerla.
   */
  app.post("/api/v1/graph/scope", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({
      resourceId: z.string().min(1),
      kinds: z.array(z.enum(["note", "flashcard", "occlusion", "document", "recording", "event", "task"])).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });

    const { g } = await ensure(s);
    const res = g.resources.find((r) => r.id === body.data.resourceId);
    if (!res) {
      return reply.code(404).send({
        error: "not_in_graph",
        warning: "Ese recurso no está en el índice. Puede que lo acabes de borrar.",
      });
    }
    const scope = scopeOf(g, body.data.resourceId);
    const limit = body.data.limit ?? 60;

    const queue = g.resources
      .filter((r) => scope.ids.has(r.id))
      .filter((r) => r.words >= 3)
      .filter((r) => !body.data.kinds || body.data.kinds.includes(r.kind))
      // Lo más antiguo y menos tocado primero: es justo lo que "se ha
      // quedado atrás" significa.
      .sort((a, b) => (a.lastTouchedAt || 0) - (b.lastTouchedAt || 0) || a.updatedAt - b.updatedAt)
      .slice(0, limit);

    return {
      resourceId: body.data.resourceId,
      title: res.title,
      mode: scope.mode,
      label: scope.label,
      total: queue.length,
      byKind: queue.reduce<Record<string, number>>((a, r) => ({ ...a, [r.kind]: (a[r.kind] || 0) + 1 }), {}),
      queue: queue.map((r) => ({
        id: r.id, kind: r.kind, title: r.title, words: r.words,
        source: r.source, lastTouchedAt: r.lastTouchedAt, touches: r.touches,
      })),
      oldest: queue[0]?.lastTouchedAt || 0,
    };
  });

  /** Lo que lleva tiempo sin tocarse: el "contenido antiguo". */
  app.get<{ Querystring: { days?: string } }>("/api/v1/graph/stale", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const days = Number(req.query.days) || 45;
    const cutoff = Date.now() - days * 86400000;
    const { g } = await ensure(s);
    const stale = g.resources
      .filter((r) => r.updatedAt > 0 && r.updatedAt < cutoff && r.words >= 3)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((r) => ({
        id: r.id, kind: r.kind, title: r.title, words: r.words,
        lastTouchedAt: r.lastTouchedAt, touches: r.touches,
        daysIdle: Math.floor((Date.now() - r.updatedAt) / 86400000),
        everStudied: r.touches > 0,
      }));
    return { days, count: stale.length, resources: stale.slice(0, 100) };
  });

  /**
   * De un id a donde se abre. Es lo que hace que el grafo no sea un
   * indice muerto: cada recurso sabe volver a su sitio.
   */
  app.get<{ Params: { id: string } }>("/api/v1/graph/resolve/:id", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const { g } = await ensure(s);
    const id = decodeURIComponent(req.params.id);
    const r = g.resources.find((x) => x.id === id);
    if (!r) return reply.code(404).send({ error: "not_in_graph" });

    // Hash de la ruta y, si el recurso es un trozo, a la página.
    const hash =
      r.kind === "note" ? "#/notes" :
      r.kind === "document" ? "#/pdf" :
      r.kind === "recording" ? "#/journal" :
      r.kind === "flashcard" ? "#/study" :
      r.kind === "event" ? "#/calendar" :
      r.kind === "task" ? "#/todos" : "#/overview";

    const out: Record<string, unknown> = { id, kind: r.kind, title: r.title, hash, source: r.source };
    if (r.source.page !== undefined) {
      out.page = r.source.page;
      out.locator = r.source.page;
      if (r.kind === "document") {
        const doc = g.resources.find((d) => d.id === `document:${r.source.parentId ?? ""}`);
        out.anchor = { docId: r.source.parentId, page: r.source.page, lineStart: r.source.lineStart, lineEnd: r.source.lineEnd };
        if (doc) out.fileName = doc.title;
      }
    }
    const origin = g.edges.find((e) => e.kind === "generated_from" && e.from === r.id);
    if (origin) {
      const note = g.resources.find((x) => x.id === origin.to);
      if (note) out.origin = { id: note.id, title: note.title, hash: "#/notes" };
    }
    return out;
  });
}
