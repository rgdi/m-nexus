// pdfAnnotation.ts: rutas de highlights PDF (v0.60 P2.1)
import { FastifyInstance } from "fastify";
import { getPdfAnnotationService } from "../services/pdfAnnotationService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function pdfAnnotationRoutes(app: FastifyInstance): Promise<void> {
  const svc = getPdfAnnotationService();

  app.get<{ Querystring: { documentPath: string } }>(
    "/pdf/highlights",
    async (req) => {
      const dp = req.query.documentPath;
      if (!dp) throw E.val("EC-PDFA-001", "documentPath requerido", { context: { qs: req.query } });
      return { highlights: svc.list(dp), count: svc.list(dp).length };
    },
  );

  app.post<{ Body: { documentPath: string; page: number; format: string; text: string; color?: string; noteId?: string } }>(
    "/pdf/highlights",
    async (req, reply) => {
      const b = req.body ?? {} as any;
      if (!b.documentPath || b.page == null || !b.text || !b.format) {
        throw E.val("EC-PDFA-002", "Faltan campos: documentPath, page, format, text", { context: { body: b } });
      }
      if (b.format !== "text" && b.format !== "rect") {
        throw E.val("EC-PDFA-003", "format debe ser text|rect", { context: { format: b.format } });
      }
      const h = svc.add({
        documentPath: b.documentPath,
        page: b.page,
        format: b.format as "text" | "rect",
        text: b.text,
        color: b.color ?? "#FFEB3B",
        noteId: b.noteId,
      });
      reply.code(201);
      logOp("pdf", "highlight added", true, { documentPath: b.documentPath, page: b.page });
      return h;
    },
  );

  app.patch<{ Params: { id: string }; Body: { documentPath: string; text?: string; color?: string; noteId?: string } }>(
    "/pdf/highlights/:id",
    async (req) => {
      const b = req.body ?? {} as any;
      if (!b.documentPath) {
        throw E.val("EC-PDFA-004", "documentPath requerido", { context: { body: b } });
      }
      const h = svc.update(req.params.id, b.documentPath, {
        text: b.text, color: b.color, noteId: b.noteId,
      });
      if (!h) throw E.val("EC-PDFA-005", "Highlight no encontrado", {
        context: { id: req.params.id }, statusCode: 404,
      });
      return h;
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { documentPath: string } }>(
    "/pdf/highlights/:id",
    async (req) => {
      const dp = req.query.documentPath;
      if (!dp) throw E.val("EC-PDFA-006", "documentPath requerido", { context: { qs: req.query } });
      const ok = svc.remove(req.params.id, dp);
      if (!ok) throw E.val("EC-PDFA-007", "Highlight no encontrado", {
        context: { id: req.params.id }, statusCode: 404,
      });
      return { deleted: true };
    },
  );

  app.get<{ Querystring: { documentPath: string } }>(
    "/pdf/highlights/export",
    async (req) => {
      const dp = req.query.documentPath;
      if (!dp) throw E.val("EC-PDFA-008", "documentPath requerido", { context: { qs: req.query } });
      const md = svc.exportAsMarkdown(dp);
      return { markdown: md, highlightCount: svc.list(dp).length };
    },
  );
}
