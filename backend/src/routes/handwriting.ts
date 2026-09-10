// handwriting.ts: rutas de reconocimiento de handwriting (v0.60 P2.2)
import { FastifyInstance } from "fastify";
import { getHandwritingService, type Stroke } from "../services/handwritingService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function handwritingRoutes(app: FastifyInstance): Promise<void> {
  const svc = getHandwritingService();

  app.post<{ Body: { strokes?: Stroke[] } }>(
    "/handwriting/recognize",
    async (req) => {
      const strokes = req.body?.strokes;
      if (!Array.isArray(strokes) || strokes.length === 0) {
        throw E.val("EC-HW-001", "strokes debe ser array no vacio", { context: { got: strokes?.length } });
      }
      // Validar shape
      for (const s of strokes) {
        if (typeof s?.x !== "number" || typeof s?.y !== "number" || typeof s?.t !== "number") {
          throw E.val("EC-HW-002", "stroke invalido: x, y, t deben ser number", { context: { stroke: s } });
        }
      }
      const result = await svc.recognize(strokes);
      logOp("handwriting", "recognize", true, {
        source: result.source, durationMs: result.durationMs, words: result.words.length,
      });
      return result;
    },
  );

  app.get("/handwriting/info", async () => ({
    description: "Handwriting recognition service",
    minStrokes: 2,
    requiredFields: ["x", "y", "t"],
    supportedEngines: ["tesseract", "heuristic"],
    tesseractAvailable: await checkTesseract(),
  }));
}

async function checkTesseract(): Promise<boolean> {
  try {
    const { exec } = await import("node:child_process");
    await new Promise<void>((res, rej) => {
      exec("tesseract --version 2>&1", (e) => e ? rej(e) : res());
    });
    return true;
  } catch { return false; }
}
