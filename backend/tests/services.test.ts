import { describe, it, expect } from "vitest";
import { WhisperService } from "../src/services/whisper.js";
import { LLMService } from "../src/services/llm.js";
import { OCRService } from "../src/services/ocr.js";
import { EmbeddingsService } from "../src/services/embeddings.js";

// Todos los MOCK_* están activados en setup.ts

describe("WhisperService (MOCK)", () => {
  const svc = new WhisperService();

  it("isAvailable() devuelve true con MOCK", async () => {
    expect(await svc.isAvailable()).toBe(true);
  });

  it("transcribe devuelve texto simulado y segmentos", async () => {
    const audio = Buffer.alloc(32_000, 1); // 32KB
    const res = await svc.transcribe(audio, { mimeType: "audio/mp3", language: "es" });
    expect(res.text).toBeTruthy();
    expect(res.language).toBe("es");
    expect(res.durationSec).toBe(2); // 32KB / 16KB = 2s
    expect(res.segments.length).toBeGreaterThan(0);
  });

  it("transcribe con audio grande genera más segmentos", async () => {
    const audio = Buffer.alloc(80_000, 1); // 80KB → 5s → 1 segmento (max 3)
    const res = await svc.transcribe(audio, {});
    expect(res.segments.length).toBeGreaterThanOrEqual(1);
    expect(res.segments.length).toBeLessThanOrEqual(3);
  });
});

describe("LLMService (MOCK)", () => {
  const svc = new LLMService();

  it("ollamaAvailable y openrouterAvailable son true", async () => {
    expect(await svc.ollamaAvailable()).toBe(true);
    expect(await svc.openrouterAvailable()).toBe(true);
  });

  it("chat devuelve texto que contiene MOCK", async () => {
    const res = await svc.chat({
      messages: [{ role: "user", content: "hola mundo" }],
    });
    expect(res.content).toContain("MOCK");
    expect(res.model).toBeTruthy();
  });

  it("chat con responseFormat=json devuelve JSON", async () => {
    const res = await svc.chat({
      messages: [{ role: "user", content: "dame un json" }],
      responseFormat: "json",
    });
    expect(() => JSON.parse(res.content)).not.toThrow();
  });
});

describe("OCRService (MOCK)", () => {
  const svc = new OCRService();

  it("isAvailable() devuelve true con MOCK", async () => {
    expect(await svc.isAvailable()).toBe(true);
  });

  it("recognize devuelve texto y bloques", async () => {
    const img = Buffer.alloc(1024, 1);
    const res = await svc.recognize(img, {});
    expect(res.text).toBeTruthy();
    expect(res.confidence).toBeGreaterThan(0);
    expect(res.blocks.length).toBeGreaterThan(0);
  });
});

describe("EmbeddingsService (MOCK)", () => {
  const svc = new EmbeddingsService();

  it("isAvailable() devuelve true con MOCK", async () => {
    expect(await svc.isAvailable()).toBe(true);
  });

  it("embed devuelve vectores con dim=1024", async () => {
    const res = await svc.embed(["hola", "adiós"]);
    expect(res.dim).toBe(1024);
    expect(res.embeddings).toHaveLength(2);
    expect(res.embeddings[0]).toHaveLength(1024);
  });

  it("embeddings son deterministas (mismo input → mismo output)", async () => {
    const a = await svc.embed(["test"]);
    const b = await svc.embed(["test"]);
    expect(a.embeddings[0]).toEqual(b.embeddings[0]);
  });

  it("textos diferentes → embeddings diferentes", async () => {
    const a = await svc.embed(["alpha"]);
    const b = await svc.embed(["beta"]);
    expect(a.embeddings[0]).not.toEqual(b.embeddings[0]);
  });
});
