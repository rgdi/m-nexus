/* ============================================================
 * routes/pdfOcclusion.ts — API REST para oclusiones PDF.
 *
 * v2.29.0 — Image Occlusion v2:
 *   GET    /api/v1/pdf/occlusions?documentPath=...
 *   POST   /api/v1/pdf/occlusions
 *   PATCH  /api/v1/pdf/occlusions/:id
 *   DELETE /api/v1/pdf/occlusions/:id?documentPath=...
 *   POST   /api/v1/pdf/occlusions/:id/cards
 *   POST   /api/v1/pdf/occlusions/batch/cards?documentPath=...
 *   GET    /api/v1/pdf/occlusions/:id
 *
 * Sin autenticación (offline-first / dispositivos registrados ya están
 * exentos). El front-end hace fetch directo.
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { pdfOcclusionStorage } from "../services/pdfOcclusionStorage.js";
import {
  createAtomicCardFromOcclusion,
  batchFromOcclusions,
} from "../services/pdfOcclusionAtomic.js";
import { pdfCrdtSync } from "../services/pdfCrdtSync.js";
import { logOp } from "../utils/log.js";

export async function pdfOcclusionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/pdf/occlusions?documentPath=...
  app.get<{ Querystring: { documentPath?: string } }>(
    "/api/v1/pdf/occlusions",
    async (req, reply) => {
      const dp = req.query.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const list = await pdfOcclusionStorage.list(dp);
      return { occlusions: list, count: list.length };
    },
  );

  // POST /api/v1/pdf/occlusions — crear
  app.post<{
    Body: {
      documentPath: string;
      page: number;
      x: number;
      y: number;
      w: number;
      h: number;
      label?: string;
      subject?: string;
      color?: string;
      highlightId?: string;
    };
  }>(
    "/api/v1/pdf/occlusions",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.documentPath || b.page == null || b.x == null || b.y == null || b.w == null || b.h == null) {
        return reply.code(400).send({ error: "documentPath, page, x, y, w, h required" });
      }
      if (b.w <= 0 || b.h <= 0) {
        return reply.code(400).send({ error: "w and h must be > 0" });
      }
      const ocl = await pdfOcclusionStorage.add({
        id: `ocl-${randomUUID()}`,
        documentPath: b.documentPath,
        page: b.page,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        label: b.label,
        subject: b.subject,
        color: b.color ?? "#1a1a1a",
        state: "raw",
        highlightId: b.highlightId,
      });
      reply.code(201);
      logOp("pdf-occlusion", "created", true, { id: ocl.id, documentPath: b.documentPath });
      void pdfCrdtSync.applyLocalOp(b.documentPath, "occlusions", "create", ocl).catch(() => {});
      return ocl;
    },
  );

  // PATCH /api/v1/pdf/occlusions/:id — actualizar (mover, redimensionar, label)
  app.patch<{
    Params: { id: string };
    Body: {
      documentPath: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      label?: string;
      subject?: string;
      color?: string;
      state?: "raw" | "card-created" | "card-rejected";
    };
  }>(
    "/api/v1/pdf/occlusions/:id",
    async (req, reply) => {
      const b = req.body ?? {};
      if (!b.documentPath) return reply.code(400).send({ error: "documentPath required" });
      const updated = await pdfOcclusionStorage.update(req.params.id, b.documentPath, {
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        label: b.label,
        subject: b.subject,
        color: b.color,
        state: b.state,
      });
      if (!updated) return reply.code(404).send({ error: "Occlusion not found" });
      void pdfCrdtSync.applyLocalOp(b.documentPath, "occlusions", "update", updated).catch(() => {});
      return updated;
    },
  );

  // DELETE /api/v1/pdf/occlusions/:id?documentPath=...
  app.delete<{ Params: { id: string }; Querystring: { documentPath?: string } }>(
    "/api/v1/pdf/occlusions/:id",
    async (req, reply) => {
      const dp = req.query.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const ok = await pdfOcclusionStorage.remove(req.params.id, dp);
      if (!ok) return reply.code(404).send({ error: "Occlusion not found" });
      void pdfCrdtSync.applyLocalOp(dp, "occlusions", "delete", { id: req.params.id }).catch(() => {});
      return { deleted: true };
    },
  );

  // GET /api/v1/pdf/occlusions/:id
  app.get<{ Params: { id: string } }>(
    "/api/v1/pdf/occlusions/:id",
    async (req, reply) => {
      const ocl = await pdfOcclusionStorage.findById(req.params.id);
      if (!ocl) return reply.code(404).send({ error: "Occlusion not found" });
      return ocl;
    },
  );

  // POST /api/v1/pdf/occlusions/:id/cards — crear card
  app.post<{ Params: { id: string }; Body: { preferType?: "basic" | "image_occlusion"; subject?: string } }>(
    "/api/v1/pdf/occlusions/:id/cards",
    async (req, reply) => {
      const ocl = await pdfOcclusionStorage.findById(req.params.id);
      if (!ocl) return reply.code(404).send({ error: "Occlusion not found" });
      const result = await createAtomicCardFromOcclusion({
        occlusion: ocl,
        preferType: req.body?.preferType,
        subject: req.body?.subject,
      });
      if (!result.ok) return reply.code(400).send(result);
      return result;
    },
  );

  // POST /api/v1/pdf/occlusions/batch/cards?documentPath=...
  app.post<{ Body: { documentPath: string } }>(
    "/api/v1/pdf/occlusions/batch/cards",
    async (req, reply) => {
      const dp = req.body?.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const result = await batchFromOcclusions(dp);
      logOp("pdf-occlusion", "batch_cards", true, { documentPath: dp, persisted: result.persisted });
      return result;
    },
  );
}
