// v0.22: Rutas para transcripción en tiempo real.

import type { FastifyInstance } from "fastify";
import { StreamingTranscriptionHandler, MockStreamingTranscriber } from "../services/streamingTranscription";

export async function registerTranscriptionStreamRoutes(app: FastifyInstance) {
  const handler = new StreamingTranscriptionHandler(new MockStreamingTranscriber());

  // POST /transcription/stream — recibe audio chunks y devuelve SSE
  app.post("/transcription/stream", async (req, reply) => {
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
  });
}
