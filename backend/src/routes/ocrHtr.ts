/* ============================================================
 * routes/ocrHtr.ts — OCR/HTR endpoints.
 *
 * v2.32.0:
 *   POST /api/v1/ocr/image    { image, lang?, psm? } → OcrResult
 *   POST /api/v1/htr/region   { image, subject?, model?, fallbackText? } → OcrResult
 *   GET  /api/v1/ocr/probe    → { tesseract, ollama, ollamaModels }
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { ocrHtr } from "../services/ocrHtr.js";

export async function ocrHtrRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { image: string; lang?: string; psm?: number } }>(
    "/api/v1/ocr-v2/image",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.image || typeof b.image !== "string") {
        return reply.code(400).send({ error: "image required (path or data: URL)" });
      }
      try {
        const r = await ocrHtr.ocrImage({ image: b.image, lang: b.lang, psm: b.psm });
        return r;
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message ?? "OCR failed" });
      }
    },
  );

  app.post<{
    Body: { image: string; subject?: string; model?: string; fallbackText?: string };
  }>("/api/v1/htr/region", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.image || typeof b.image !== "string") {
      return reply.code(400).send({ error: "image required (path or data: URL)" });
    }
    try {
      const r = await ocrHtr.htrRegion({
        image: b.image,
        subject: b.subject,
        model: b.model,
        fallbackText: b.fallbackText,
      });
      return r;
    } catch (e: any) {
      return reply.code(500).send({ error: e?.message ?? "HTR failed" });
    }
  });

  app.get("/api/v1/ocr-v2/probe", async () => ocrHtr.probeEnvironment());
}
