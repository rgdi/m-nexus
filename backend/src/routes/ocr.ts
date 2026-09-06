// Rutas OCR.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { OCRService } from "../services/ocr.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";
import { getMetrics } from "../utils/metrics.js";

interface OcrBody {
  imageBase64?: string;
  language?: string;
  preprocess?: boolean;
}

export async function ocrRoutes(app: FastifyInstance): Promise<void> {
  const ocr = new OCRService();

  app.post("/api/v1/ocr/image", async (req, reply) => {
    const body = (req.body ?? {}) as OcrBody;
    const r = await safeCallAsync({
      component: "ocr",
      code: "EC-OCR-001",
      message: "ocr.image failed",
      context: {
        hasImage: !!body.imageBase64,
        imageLen: body.imageBase64?.length ?? 0,
        language: body.language,
        preprocess: body.preprocess,
      },
      op: async () => {
        if (!body.imageBase64) {
          throw E.val("EC-OCR-002", "imageBase64 requerido", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { imageBase64: '...', language, preprocess }",
          });
        }
        if (!(await ocr.isAvailable())) {
          throw E.ext("EC-OCR-003", "Tesseract not available", {
            context: { language: body.language },
            hint: "Install tesseract-ocr or set TESSERACT_BINARY",
            statusCode: 503,
          });
        }
        const image = Buffer.from(body.imageBase64, "base64");
        const result = await ocr.recognize(image, { language: body.language });
        getMetrics().incCounter("mnexus_ocr_images_total", { language: body.language ?? "default" });
        logOp("ocr", "image", true, { language: body.language, textLen: result.text?.length ?? 0 });
        return result;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}
