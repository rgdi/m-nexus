// Rutas de audio: transcripción con Whisper.

import { FastifyInstance } from "fastify";
import { WhisperService } from "../services/whisper.js";
import { audit } from "../auth/audit.js";

export async function audioRoutes(app: FastifyInstance): Promise<void> {
  const whisper = new WhisperService();

  app.post("/api/v1/audio/transcribe", async (req, reply) => {
    const body = req.body as {
      audioBase64?: string;
      mimeType?: string;
      language?: string;
      prompt?: string;
      model?: string;
    };
    if (!body?.audioBase64) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "audioBase64 requerido" });
      return;
    }
    if (!(await whisper.isAvailable())) {
      reply.code(503).send({
        code: "WHISPER_UNAVAILABLE",
        message: "Whisper binary no disponible en el servidor. Configura WHISPER_BINARY.",
      });
      return;
    }
    try {
      const audio = Buffer.from(body.audioBase64, "base64");
      const t0 = Date.now();
      const result = await whisper.transcribe(audio, {
        mimeType: body.mimeType,
        language: body.language,
        model: body.model,
      });
      const dur = (Date.now() - t0) / 1000;
      const metrics = await import("../utils/metrics.js");
      const m = metrics.getMetrics();
      m.incCounter("mnexus_whisper_transcriptions_total", { model: body.model ?? "default" });
      m.observeHistogram("mnexus_whisper_transcription_duration_seconds", { model: body.model ?? "default" }, dur);
      audit({
        deviceId: (req as { auth?: { sub?: string } }).auth?.sub ?? "(unknown)",
        action: "audio.transcribe",
        allowed: true,
        meta: { bytes: audio.length, language: body.language, model: body.model },
      });
      return result;
    } catch (e) {
      audit({
        deviceId: (req as { auth?: { sub?: string } }).auth?.sub ?? "(unknown)",
        action: "audio.transcribe.failed",
        allowed: false,
        meta: { error: (e as Error).message },
      });
      reply.code(500).send({ code: "WHISPER_ERROR", message: (e as Error).message });
    }
  });
}
