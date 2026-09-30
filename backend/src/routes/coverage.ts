// routes/coverage.ts — cruzar una clase con el material del profesor.
//
// v2.38.9
//
//   POST /api/v1/coverage/index     sube un recurso y lo indexa
//   GET  /api/v1/coverage/index     qué hay indexado
//   POST /api/v1/coverage/cross     el cruce de una transcripción
//   GET  /api/v1/coverage/locate    abre un trozo concreto del documento
//
// Todo cuelga del store por usuario: los índices son personales, igual
// que las notas. El mismo PowerPoint en dos cuentas son dos índices.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { readCollection, writeCollection, currentSubject } from "../services/userStore.js";
import {
  indexResource,
  crossReference,
  type IndexedDoc,
  type CoverageReport,
} from "../services/resourceIndex.js";
import { logOp } from "../utils/log.js";

const STORE = "resource-index.json";
const MAX_BYTES = 40 * 1024 * 1024;

const indexSchema = z.object({
  fileName: z.string().min(1).max(260),
  /** Base64. Se acepta data URL entera o solo el payload. */
  data: z.string().min(1),
  docId: z.string().max(80).optional(),
});

function decodeMaybeDataUrl(s: string): Buffer {
  const clean = s.startsWith("data:") ? s.slice(s.indexOf(",") + 1) : s;
  return Buffer.from(clean, "base64");
}

export async function coverageRoutes(app: FastifyInstance): Promise<void> {
  const sub = (_req: FastifyRequest) => currentSubject();

  const load = (s: string) => readCollection<IndexedDoc[]>(s, STORE, []);

  app.post("/api/v1/coverage/index", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = indexSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });

    let buf: Buffer;
    try {
      buf = decodeMaybeDataUrl(body.data.data);
    } catch {
      return reply.code(400).send({ error: "bad_base64" });
    }
    if (!buf.length) return reply.code(400).send({ error: "empty" });
    if (buf.length > MAX_BYTES) {
      return reply.code(413).send({ error: "too_large", maxBytes: MAX_BYTES });
    }

    const docId = body.data.docId || "doc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    const doc = await indexResource(docId, body.data.fileName, buf);

    // Si no se ha podido leer, se devuelve con su aviso y NO se guarda:
    // un índice vacío que parece un índice es la peor de las salidas.
    if (!doc.chunks.length) {
      logOp("coverage", "index_failed", false, { docId, fileName: doc.fileName, reason: doc.warning });
      return reply.code(422).send({ error: "not_indexable", warning: doc.warning, fileName: doc.fileName });
    }

    const all = await load(s);
    const at = all.findIndex((d) => d.id === docId);
    if (at >= 0) all[at] = doc;
    else all.push(doc);
    await writeCollection(s, STORE, all);

    logOp("coverage", "indexed", true, { docId, fileName: doc.fileName, chunks: doc.chunks.length, pages: doc.pages });
    return {
      id: doc.id,
      fileName: doc.fileName,
      kind: doc.kind,
      pages: doc.pages,
      chunks: doc.chunks.length,
      words: doc.chunks.reduce((a, c) => a + c.words, 0),
      warning: doc.warning,
    };
  });

  app.get("/api/v1/coverage/index", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const all = await load(s);
    return {
      docs: all.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        kind: d.kind,
        pages: d.pages,
        chunks: d.chunks.length,
        words: d.chunks.reduce((a, c) => a + c.words, 0),
        warning: d.warning,
        indexedAt: d.indexedAt,
      })),
    };
  });

  const crossSchema = z.object({
    /** Texto de la clase: transcripción o apuntes. */
    transcript: z.string().min(1).max(400_000),
    /** Qué de la transcripción es de qué clase, si se sabe. */
    label: z.string().max(160).optional(),
    /** Limitar a estos documentos. Vacío = todos. */
    docIds: z.array(z.string()).optional(),
  });

  app.post("/api/v1/coverage/cross", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = crossSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });

    const all = await load(s);
    const docs = body.data.docIds?.length ? all.filter((d) => body.data.docIds!.includes(d.id)) : all;
    if (!docs.length) {
      return reply.code(409).send({
        error: "no_resources",
        warning: "No hay material indexado. Sube el PDF, el PowerPoint o el Word del profesor y vuelve a probar.",
      });
    }

    const t0 = Date.now();
    const report: CoverageReport = crossReference(body.data.transcript, docs);
    logOp("coverage", "cross", true, {
      docs: docs.length,
      sentences: report.total,
      ratio: Math.round(report.ratio * 100),
      missing: report.missing.length,
      unreviewed: report.unreviewed.length,
      ms: Date.now() - t0,
    });

    return { ...report, label: body.data.label ?? null, ms: Date.now() - t0, docCount: docs.length };
  });

  /**
   * Abrir un punto exacto del documento. Devuelve el trozo de texto con
   * su página, para que el frontend pueda llevar al usuario hasta allí
   * en vez de describir dónde está.
   */
  app.get<{ Querystring: { doc: string; chunk?: string; page?: string } }>(
    "/api/v1/coverage/locate",
    async (req, reply) => {
      const s = sub(req);
      if (!s) return reply.code(401).send({ error: "unauthorized" });
      const all = await load(s);
      const doc = all.find((d) => d.id === req.query.doc);
      if (!doc) return reply.code(404).send({ error: "doc_not_found" });

      const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
      const list: IndexedDoc["chunks"] = req.query.chunk
        ? doc.chunks.filter((c) => c.id === req.query.chunk)
        : page !== undefined
          ? doc.chunks.filter((c) => c.provenance.page === page)
          : doc.chunks;

      return {
        docId: doc.id,
        fileName: doc.fileName,
        kind: doc.kind,
        pages: doc.pages,
        page,
        locator: page !== undefined
          ? doc.kind === "pptx" ? `diapositiva ${page + 1}` : `pág. ${page + 1}`
          : null,
        chunks: list.slice(0, 12).map((c) => ({
          id: c.id,
          text: c.text,
          lineStart: c.provenance.lineStart,
          lineEnd: c.provenance.lineEnd,
          locator: c.provenance.locator,
        })),
      };
    },
  );
}
