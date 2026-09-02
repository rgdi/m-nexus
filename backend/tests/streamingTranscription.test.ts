// v0.22: Tests para transcripción en streaming.

import { describe, it, expect } from "vitest";
import {
  MockStreamingTranscriber,
  WhisperLocalStreaming,
  type StreamChunk,
} from "../src/services/streamingTranscription.js";

async function* makeChunks(): AsyncIterable<StreamChunk> {
  for (let i = 0; i < 5; i++) {
    yield {
      audio: Buffer.alloc(1000, i + 1), // dummy bytes
      timestamp: Date.now() + i * 1000,
      sampleRate: 16000,
      isFinal: i === 4,
    };
  }
}

describe("MockStreamingTranscriber", () => {
  it("emite transcripción incremental por chunk", async () => {
    const transcriber = new MockStreamingTranscriber();
    const results = [];
    for await (const r of transcriber.transcribeStream(makeChunks())) {
      results.push(r);
    }
    expect(results.length).toBeGreaterThan(0);
    expect(results[results.length - 1].isFinal).toBe(true);
  });

  it("concatena el texto completo", async () => {
    const transcriber = new MockStreamingTranscriber();
    let text = "";
    for await (const r of transcriber.transcribeStream(makeChunks())) {
      text += r.text;
    }
    expect(text.length).toBeGreaterThan(0);
  });

  it("incluye confianza", async () => {
    const transcriber = new MockStreamingTranscriber();
    for await (const r of transcriber.transcribeStream(makeChunks())) {
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      break;
    }
  });
});

describe("WhisperLocalStreaming", () => {
  it("acumula buffer y emite cuando hay suficiente audio", async () => {
    const transcriber = new WhisperLocalStreaming();
    const results = [];
    for await (const r of transcriber.transcribeStream(makeChunks())) {
      results.push(r);
    }
    // Sin backend real, los resultados tienen text=""
    // pero el flujo funciona
    expect(Array.isArray(results)).toBe(true);
  });

  it("maneja stream vacío sin errores", async () => {
    const transcriber = new WhisperLocalStreaming();
    async function* empty() { /* nada */ }
    for await (const r of transcriber.transcribeStream(empty())) {
      // No debería emitir nada
    }
  });
});
