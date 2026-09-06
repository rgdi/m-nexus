// v0.22: Transcripción en tiempo real (streaming).
// Recibe chunks de audio (WebSocket o SSE) y devuelve transcripción incremental.

import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
import type { IncomingMessage, ServerResponse } from "http";

export interface StreamChunk {
  /** Audio crudo (PCM o WebM). */
  audio: Buffer;
  /** Timestamp (ms) del momento de captura. */
  timestamp: number;
  /** Sample rate del chunk. */
  sampleRate: number;
  /** Si es el último chunk. */
  isFinal?: boolean;
}

export interface StreamResult {
  /** Texto nuevo detectado en este chunk. */
  text: string;
  /** Si la frase se considera completa. */
  isFinal: boolean;
  /** Confianza del modelo (0..1). */
  confidence?: number;
  /** Timestamp de inicio del segmento. */
  startMs: number;
  /** Timestamp de fin. */
  endMs: number;
}

/** Interfaz común para providers (Whisper, Deepgram, Google STT). */
export interface StreamingTranscriber {
  transcribeStream(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamResult>;
}

/** Provider Whisper local (sin streaming real, chunks se acumulan). */
export class WhisperLocalStreaming implements StreamingTranscriber {
  private buffer: Buffer[] = [];
  private sampleRate: number = 16000;
  private minBufferMs: number = 1000;

  async *transcribeStream(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamResult> {
    for await (const chunk of chunks) {
      this.buffer.push(chunk.audio);
      this.sampleRate = chunk.sampleRate;
      // Emitir cada vez que acumulamos suficiente
      const totalBytes = this.buffer.reduce((s, b) => s + b.length, 0);
      const totalMs = (totalBytes / (this.sampleRate * 2)) * 1000;
      if (totalMs >= this.minBufferMs) {
        const result = await this.transcribeBuffer();
        if (result) yield result;
        if (chunk.isFinal && this.buffer.length > 0) {
          const finalResult = await this.transcribeBuffer();
          if (finalResult) {
            yield { ...finalResult, isFinal: true };
          }
          this.buffer = [];
        } else if (!chunk.isFinal) {
          // Mantener el último 200ms para overlap (contexto)
          const overlapBytes = Math.floor((this.sampleRate * 2) * 0.2);
          const allBytes = Buffer.concat(this.buffer);
          this.buffer = [allBytes.subarray(Math.max(0, allBytes.length - overlapBytes))];
        }
      }
      if (chunk.isFinal) {
        this.buffer = [];
      }
    }
  }

  private async transcribeBuffer(): Promise<StreamResult | null> {
    if (this.buffer.length === 0) return null;
    // En implementación real, llamaríamos a whisper.cpp o similar.
    // Por ahora devolvemos un placeholder que el frontend puede mostrar.
    return {
      text: "",
      isFinal: false,
      startMs: 0,
      endMs: 0,
    };
  }
}

/** Mock provider para tests / dev. */
export class MockStreamingTranscriber implements StreamingTranscriber {
  private phrases: string[] = [
    "La membrana celular",
    " está compuesta por",
    " una bicapa lipídica",
    " con proteínas",
    " incrustadas.",
  ];
  private index = 0;

  async *transcribeStream(chunks: AsyncIterable<StreamChunk>): AsyncIterable<StreamResult> {
    for await (const chunk of chunks) {
      if (chunk.audio.length > 0 && this.index < this.phrases.length) {
        const phrase = this.phrases[this.index++];
        yield {
          text: phrase,
          isFinal: chunk.isFinal ?? false,
          confidence: 0.92,
          startMs: chunk.timestamp,
          endMs: chunk.timestamp + 1000,
        };
      }
      if (chunk.isFinal) {
        this.index = 0;
      }
    }
  }
}

/**
 * Server-Sent Events handler: cliente envía chunks vía POST, recibe resultados
 * vía SSE stream.
 */
export class StreamingTranscriptionHandler {
  private transcriber: StreamingTranscriber;

  constructor(transcriber?: StreamingTranscriber) {
    this.transcriber = transcriber ?? new MockStreamingTranscriber();
  }

  getTranscriber(): StreamingTranscriber {
    return this.transcriber;
  }

  /**
   * Maneja la request HTTP: lee el body (concatenated chunks) y produce
   * respuestas SSE.
   */
  async handleSSE(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunks: StreamChunk[] = [];
    const sampleRate = Number(req.headers["x-sample-rate"] ?? 16000);

    await new Promise<void>((resolve) => {
      req.on("data", (chunk: Buffer) => {
        chunks.push({
          audio: chunk,
          timestamp: Date.now(),
          sampleRate,
        });
      });
      req.on("end", () => resolve());
    });

    const last = chunks[chunks.length - 1];
    if (last) last.isFinal = true;

    async function* gen() {
      for (const c of chunks) yield c;
    }

    for await (const result of this.transcriber.transcribeStream(gen())) {
      res.write(`data: ${JSON.stringify(result)}\n\n`);
      if (result.isFinal) break;
    }
    res.write("data: [DONE]\n\n");
    res.end();
  }
}
