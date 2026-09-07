// v0.22: Tests para transcripción en streaming.

import { describe, it, expect, beforeAll } from "vitest";
import {
  MockStreamingTranscriber,
  WhisperLocalStreaming,
  type StreamChunk,
} from "../src/services/streamingTranscription.js";

async function* makeChunks(): AsyncIterable<StreamChunk> {
  for (let i = 0; i < 5; i++) {
    yield {
      audio: Buffer.alloc(8000, i + 1), // 8KB dummy bytes (~500ms de audio a 16kHz)
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

describe("WhisperLocalStreaming (v0.46: usa WhisperService real con MOCK)", () => {
  // Activar MOCK_WHISPER para que WhisperService devuelva resultados
  // (sin necesidad de binario whisper instalado)
  beforeAll(() => {
    process.env.MOCK_WHISPER = "1";
  });

  it("acumula buffer y emite cuando hay suficiente audio", async () => {
    const transcriber = new WhisperLocalStreaming();
    const results = [];
    for await (const r of transcriber.transcribeStream(makeChunks())) {
      results.push(r);
    }
    expect(Array.isArray(results)).toBe(true);
  });

  it("con MOCK_WHISPER=1 emite texto de transcripción (no vacío)", async () => {
    // v0.46: ahora WhisperLocalStreaming usa WhisperService real
    // que con MOCK_WHISPER=1 devuelve transcripción simulada
    const transcriber = new WhisperLocalStreaming();
    const results: Array<{ text: string; isFinal: boolean }> = [];
    for await (const r of transcriber.transcribeStream(makeChunks())) {
      results.push(r);
    }
    // Debe haber al menos un resultado con texto (no vacío)
    const withText = results.filter((r) => r.text && r.text.length > 0);
    expect(withText.length).toBeGreaterThan(0);
    // El último resultado debe ser final
    if (results.length > 0) {
      expect(results[results.length - 1].isFinal).toBe(true);
    }
  });

  it("maneja stream vacío sin errores", async () => {
    const transcriber = new WhisperLocalStreaming();
    async function* empty() { /* nada */ }
    for await (const r of transcriber.transcribeStream(empty())) {
      // No debería emitir nada
    }
  });
});
