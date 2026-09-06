// Rutas de audio: transcripción con Whisper.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { WhisperService } from "../services/whisper.js";
import { audit } from "../auth/audit.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
import { getMetrics } from "../utils/metrics.js";

interface TranscribeBody {
  audioBase64?: string;
  mimeType?: string;
  language?: string;
  prompt?: string;
  model?: string;
}

export async function audioRoutes(app: FastifyInstance): Promise<void> {
  const whisper = new WhisperService();

  app.post("/api/v1/audio/transcribe", async (req, reply) => {
    const body = (req.body ?? {}) as TranscribeBody;
    const r = await safeCallAsync({
      component: "aud",
      code: "EC-AUD-001",
      message: "audio.transcribe failed",
      context: {
        hasAudio: !!body.audioBase64,
        audioLen: body.audioBase64?.length ?? 0,
        mimeType: body.mimeType,
        language: body.language,
        model: body.model,
      },
      op: async () => {
        if (!body.audioBase64) {
          throw E.val("EC-AUD-002", "audioBase64 requerido", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { audioBase64: '...', mimeType, language, model }",
          });
        }
        if (!(await whisper.isAvailable())) {
          throw E.ext("EC-AUD-003", "Whisper binary not available", {
            context: { model: body.model },
            hint: "Set WHISPER_BINARY env var or install whisper.cpp",
            statusCode: 503,
          });
        }
        const audio = Buffer.from(body.audioBase64, "base64");
        const t0 = Date.now();
        const result = await whisper.transcribe(audio, {
          mimeType: body.mimeType,
          language: body.language,
          model: body.model,
        });
        const dur = (Date.now() - t0) / 1000;
        const m = getMetrics();
        m.incCounter("mnexus_whisper_transcriptions_total", { model: body.model ?? "default" });
        m.observeHistogram("mnexus_whisper_transcription_duration_seconds", { model: body.model ?? "default" }, dur);
        audit({
          deviceId: (req as { auth?: { sub?: string } }).auth?.sub ?? "(unknown)",
          action: "audio.transcribe",
          allowed: true,
          meta: { bytes: audio.length, language: body.language, model: body.model, duration: dur },
        });
        logOp("aud", "transcribe", true, { bytes: audio.length, model: body.model, dur: dur.toFixed(2) });
        return result;
      },
    });
    if (!r.success || !r.value) {
      audit({
        deviceId: (req as { auth?: { sub?: string } }).auth?.sub ?? "(unknown)",
        action: "audio.transcribe.failed",
        allowed: false,
        meta: { error: r.error?.message, code: r.error?.code },
      });
      throw r.error!;
    }
    return r.value;
  });
}
