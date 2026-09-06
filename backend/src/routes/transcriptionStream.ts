// v0.22: Rutas para transcripción en tiempo real.
// v0.45: error codes estructurados con AppError.

import type { FastifyInstance } from "fastify";
import { StreamingTranscriptionHandler, MockStreamingTranscriber } from "../services/streamingTranscription.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export async function registerTranscriptionStreamRoutes(app: FastifyInstance) {
  const handler = new StreamingTranscriptionHandler(new MockStreamingTranscriber());

  // POST /transcription/stream
  app.post("/transcription/stream", async (req, reply) => {
    const r = await safeCallAsync({
      component: "aud",
      code: "EC-AUD-030",
      message: "transcription stream failed",
      context: { sampleRate: Number(req.headers["x-sample-rate"] ?? 16000) },
      op: async () => {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const chunks: Array<{ audio: Buffer; timestamp: number; sampleRate: number; isFinal?: boolean }> = [];
        const sampleRate = Number(req.headers["x-sample-rate"] ?? 16000);
        for await (const chunk of req.raw) {
          chunks.push({
            audio: chunk as Buffer,
            timestamp: Date.now(),
            sampleRate,
          });
        }
        if (chunks.length === 0) {
          throw E.val("EC-AUD-031", "No audio chunks received", {
            context: { sampleRate },
            hint: "Send at least one audio chunk",
          });
        }
        const last = chunks[chunks.length - 1];
        if (last) last.isFinal = true;
        async function* gen() {
          for (const c of chunks) yield c;
        }
        for await (const result of handler.getTranscriber().transcribeStream(gen())) {
          reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
          if (result.isFinal) break;
        }
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        logOp("aud", "transcription stream", true, { chunks: chunks.length });
      },
    });
    if (!r.success) throw r.error!;
  });
}
