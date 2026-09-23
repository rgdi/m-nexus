/* ============================================================
 * routes/ocr.ts — Re-exports the legacy v2.32 ocrHtr routes.
 *
 * v2.32.0 OCR features live in ocrHtr.ts (legacy namespaced).
 * This file kept for backward compatibility with the /api/v1/ocr/recognize
 * surface added later (recognize-highlight).
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { ocrHandwriting } from "../services/ocrHandwriting.js";
import { shapeFromHighlight } from "../services/pdfAtomicCard.js";
import { pdfAnnotationStorage } from "../services/pdfAnnotationStorage.js";
import { logOp } from "../utils/log.js";

export async function ocrRoutes(app: FastifyInstance): Promise<void> {
  // /api/v1/ocr/recognize
  app.post<{ Body: { image?: string; imageUrl?: string; languages?: string; minConfidence?: number; detectHandwriting?: boolean; forceStrategy?: "tesseract" | "vision-llm" } }>(
    "/api/v1/ocr/recognize",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.image && !b.imageUrl) {
        return reply.code(400).send({ error: "image (base64) or imageUrl required" });
      }
      try {
        let buf: Buffer;
        if (b.image) {
          buf = Buffer.from(b.image, "base64");
        } else {
          const r = await fetch(b.imageUrl!);
          if (!r.ok) throw new Error(`imageUrl ${r.status}`);
          buf = Buffer.from(await r.arrayBuffer());
        }
        const result = await ocrHandwriting.recognize(buf, {
          languages: b.languages,
          minConfidence: b.minConfidence,
          forceStrategy: b.forceStrategy,
        });
        return { ocr: result };
      } catch (e: any) {
        return reply.code(500).send({ error: e.message ?? "OCR failed" });
      }
    },
  );

  // /api/v1/ocr/recognize-highlight
  app.post<{ Body: { image: string; highlightId?: string; documentPath?: string; page?: number; minConfidence?: number } }>(
    "/api/v1/ocr/recognize-highlight",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.image) return reply.code(400).send({ error: "image required" });
      const buf = Buffer.from(b.image, "base64");
      const ocr = await ocrHandwriting.recognize(buf, { minConfidence: b.minConfidence });
      if (!ocr.text || !b.highlightId) {
        return { ocr, atomicCard: null };
      }
      if (b.documentPath && b.highlightId) {
        try {
          await pdfAnnotationStorage.update(b.highlightId, b.documentPath, { text: ocr.text });
        } catch (e) {
          logOp("ocr", "highlight_update_failed", false, { error: String(e) });
        }
      }
      const atomicCard = shapeFromHighlight({
        highlight: {
          id: b.highlightId,
          documentPath: b.documentPath ?? "ocr-source.pdf",
          page: b.page ?? 1,
          format: "text",
          text: ocr.text,
          color: "#FFEB3B",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        } as any,
        contextBefore: "",
        contextAfter: "",
      });
      return { ocr, atomicCard };
    },
  );

  // /api/v1/ocr/stats
  app.get("/api/v1/ocr/stats", async () => {
    try {
      const fs = await import("node:fs/promises");
      const raw = await fs.readFile("/workspace/m-nexus/backend/data/ocr-cache.json", "utf-8");
      const cache = JSON.parse(raw);
      return { cacheSize: Object.keys(cache).length };
    } catch {
      return { cacheSize: 0 };
    }
  });
}
