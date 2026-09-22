// pdfAnnotation.ts: rutas de highlights PDF (v0.60 P2.1 + v2.28)
// v2.28: persisted highlights + atomic-card creation + batch.
import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { pdfAnnotationStorage } from "../services/pdfAnnotationStorage.js";
import { pdfCrdtSync } from "../services/pdfCrdtSync.js";
import { createAtomicCardFromHighlight, batchFromHighlights } from "../services/pdfAtomicCard.js";

export async function pdfAnnotationRoutes(app: FastifyInstance): Promise<void> {
  /* ---- v2.28 NEW routes (prefixed /api/v1 to match legacy pdf.ts style) ---- */
  app.get("/api/v1/pdf/pdfs", async () => {
    const all = await pdfAnnotationStorage.listAll();
    const docs = Object.entries(all).map(([docPath, highlights]) => ({
      docPath,
      count: highlights.length,
      withCard: highlights.filter((h) => h.state === "card-created").length,
      lastHighlight: highlights.reduce((acc, h) => Math.max(acc, h.updatedAt), 0),
    }));
    docs.sort((a, b) => b.lastHighlight - a.lastHighlight);
    return { documents: docs, total: docs.length };
  });

  // GET /api/v1/pdf/highlights?documentPath=...
  app.get<{ Querystring: { documentPath?: string } }>("/api/v1/pdf/highlights", async (req, reply) => {
    const dp = req.query.documentPath;
    if (!dp) return reply.code(400).send({ error: "documentPath required" });
    const highlights = await pdfAnnotationStorage.list(dp);
    return { highlights, count: highlights.length };
  });

  // POST /api/v1/pdf/highlights — create highlight (body.documentPath)
  app.post<{ Body: { documentPath: string; page: number; format: "text" | "rect"; text: string; color?: string; subject?: string; contextBefore?: string; contextAfter?: string; noteId?: string } }>(
    "/api/v1/pdf/highlights",
    async (req, reply) => {
      const b = req.body ?? {} as any;
      if (!b.documentPath || b.page == null || !b.text || !b.format) {
        return reply.code(400).send({ error: "documentPath, page, format, text required" });
      }
      if (b.format !== "text" && b.format !== "rect") {
        return reply.code(400).send({ error: "format must be text|rect" });
      }
      const created = await pdfAnnotationStorage.add({
        id: `hl-${randomUUID()}`,
        documentPath: b.documentPath,
        page: b.page,
        format: b.format,
        text: b.text,
        contextBefore: b.contextBefore,
        contextAfter: b.contextAfter,
        color: b.color ?? "#FFEB3B",
        subject: b.subject,
        noteId: b.noteId,
        state: "raw",
      });
      reply.code(201);
      logOp("pdf", "highlight added (v2.28)", true, { documentPath: b.documentPath, page: b.page });
      void pdfCrdtSync.applyLocalOp(b.documentPath, "highlights", "create", created).catch(() => {});
      return created;
    },
  );

  // PATCH /api/v1/pdf/highlights/:id
  app.patch<{ Params: { id: string }; Body: { documentPath: string; text?: string; color?: string; contextBefore?: string; contextAfter?: string; subject?: string; noteId?: string } }>(
    "/api/v1/pdf/highlights/:id",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.documentPath) return reply.code(400).send({ error: "documentPath required" });
      const updated = await pdfAnnotationStorage.update(req.params.id, b.documentPath, b);
      if (!updated) return reply.code(404).send({ error: "Highlight not found" });
      void pdfCrdtSync.applyLocalOp(b.documentPath, "highlights", "update", updated).catch(() => {});
      return updated;
    },
  );

  // DELETE /api/v1/pdf/highlights/:id
  app.delete<{ Params: { id: string }; Querystring: { documentPath: string } }>(
    "/api/v1/pdf/highlights/:id",
    async (req, reply) => {
      const dp = req.query.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const ok = await pdfAnnotationStorage.remove(req.params.id, dp);
      if (!ok) return reply.code(404).send({ error: "Highlight not found" });
      void pdfCrdtSync.applyLocalOp(dp, "highlights", "delete", { id: req.params.id }).catch(() => {});
      return { deleted: true };
    },
  );

  /* ============================================================
   * v2.28 — atomic card creation from a highlight.
   * ============================================================ */

  // POST /pdf/highlights/:id/cards — create a single atomic flashcard
  app.post<{ Params: { id: string }; Body: { preferType?: "basic" | "cloze"; contextBefore?: string; contextAfter?: string; subject?: string } }>(
    "/api/v1/pdf/highlights/:id/cards",
    async (req, reply) => {
      const hl = await pdfAnnotationStorage.findById(req.params.id);
      if (!hl) return reply.code(404).send({ error: "Highlight not found" });
      const b = req.body ?? {};
      const result = await createAtomicCardFromHighlight({
        highlight: hl,
        preferType: b.preferType,
        contextBefore: b.contextBefore,
        contextAfter: b.contextAfter,
      });
      logOp("pdf", "card created from highlight", result.ok, {
        highlightId: req.params.id,
        cardId: result.ok ? result.cardId : null,
      });
      return result;
    },
  );

  // POST /pdf/batch/cards — create cards from many highlights of a doc
  app.post<{ Body: { documentPath: string; highlightIds?: string[] } }>(
    "/api/v1/pdf/batch/cards",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.documentPath) return reply.code(400).send({ error: "documentPath required" });
      const all = await pdfAnnotationStorage.list(b.documentPath);
      const targets = Array.isArray(b.highlightIds) && b.highlightIds.length > 0
        ? all.filter((h) => b.highlightIds!.includes(h.id))
        : all.filter((h) => h.state === "raw" || !h.state);
      if (targets.length === 0) return { total: 0, ok: 0, failed: 0, persisted: 0, items: [] };
      const result = await batchFromHighlights(targets);
      logOp("pdf", "batch cards created", true, {
        documentPath: b.documentPath,
        total: result.total,
        ok: result.ok,
      });
      return result;
    },
  );

  // GET /pdf/highlights/:id — single highlight (used by atomic card modal revalidation)
  app.get<{ Params: { id: string } }>("/api/v1/pdf/highlights/:id", async (req, reply) => {
    const hl = await pdfAnnotationStorage.findById(req.params.id);
    if (!hl) return reply.code(404).send({ error: "Not found" });
    return hl;
  });
}
