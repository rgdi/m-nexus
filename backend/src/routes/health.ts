// Health check + stats.

import { FastifyInstance } from "fastify";
import { WhisperService } from "../services/whisper.js";
import { LLMService } from "../services/llm.js";
import { EmbeddingsService } from "../services/embeddings.js";
import { OCRService } from "../services/ocr.js";
import { getRegisteredDevices } from "../auth/devices.js";
import { getRefreshTokenStats } from "../auth/jwt.js";
import { getAuditStats } from "../auth/audit.js";
import { logger } from "../utils/log.js";
import { VERSION } from "../version.js";

const START_TIME = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const whisper = new WhisperService();
  const llm = new LLMService();
  const emb = new EmbeddingsService();
  const ocr = new OCRService();

  app.get("/api/v1/health", async () => {
    const mock = {
      whisper: process.env.MOCK_WHISPER === "1",
      ollama: process.env.MOCK_OLLAMA === "1",
      openrouter: process.env.MOCK_OPENROUTER === "1",
      tesseract: process.env.MOCK_TESSERACT === "1",
    };
    const [whisperOk, ollamaOk, openrouterOk, tesseractOk, embOk] = await Promise.all([
      whisper.isAvailable().catch(() => false),
      llm.ollamaAvailable().catch(() => false),
      llm.openrouterAvailable().catch(() => false),
      ocr.isAvailable().catch(() => false),
      emb.isAvailable().catch(() => false),
    ]);
    const allOk = whisperOk && (ollamaOk || openrouterOk) && tesseractOk && embOk;
    return {
      status: allOk ? "ok" : "degraded",
      version: VERSION,
      providers: {
        whisper: whisperOk ? "available" : "unavailable",
        ollama: ollamaOk ? "available" : "unavailable",
        openrouter: openrouterOk ? "available" : "unavailable",
        tesseract: tesseractOk ? "available" : "unavailable",
        embeddings: embOk ? "available" : "unavailable",
      },
      mock,
      uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
    };
  });
}
