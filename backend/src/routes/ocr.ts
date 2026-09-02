// Rutas OCR.

import { FastifyInstance } from "fastify";
import { OCRService } from "../services/ocr.js";

export async function ocrRoutes(app: FastifyInstance): Promise<void> {
  const ocr = new OCRService();

  app.post("/api/v1/ocr/image", async (req, reply) => {
    const body = req.body as {
      imageBase64?: string;
      language?: string;
      preprocess?: boolean;
    };
    if (!body?.imageBase64) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "imageBase64 requerido" });
      return;
    }
    if (!(await ocr.isAvailable())) {
      reply.code(503).send({ code: "OCR_UNAVAILABLE", message: "Tesseract no disponible" });
      return;
    }
    try {
      const image = Buffer.from(body.imageBase64, "base64");
      const result = await ocr.recognize(image, { language: body.language });
      const metrics = await import("../utils/metrics.js");
      metrics.getMetrics().incCounter("mnexus_ocr_images_total", { language: body.language ?? "default" });
      return result;
    } catch (e) {
      reply.code(500).send({ code: "OCR_ERROR", message: (e as Error).message });
    }
  });
}
