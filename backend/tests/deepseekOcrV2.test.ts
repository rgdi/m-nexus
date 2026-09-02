// v0.27: Tests del DeepSeek-OCR self-hosted.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { DeepSeekSelfHostedOCR } from "../src/services/deepseekOcrV2.js";

describe("DeepSeekSelfHostedOCR", () => {
  it("1.1 isAvailable() sin servidor retorna false", async () => {
    const ocr = new DeepSeekSelfHostedOCR({ vllmUrl: "http://localhost:1", preserveTables: true, includeImages: true, mode: "fast" });
    const ok = await ocr.isAvailable();
    expect(ok).toBe(false);
  });

  it("1.2 processFile() con servidor no disponible → fallback mock", async () => {
    const ocr = new DeepSeekSelfHostedOCR({ vllmUrl: "http://localhost:1", preserveTables: true, includeImages: true, mode: "fast" });
    const fake = path.join("/tmp", "test.png");
    await fs.writeFile(fake, Buffer.from("fake"));
    try {
      const result = await ocr.processFile(fake);
      expect(result.markdown).toBeTruthy();
    } finally {
      await fs.unlink(fake).catch(() => {});
    }
  });

  it("1.3 processFile() con servidor mock funcionando", async () => {
    // Mock del servidor vLLM
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/health")) return new Response("ok", { status: 200 });
      if (url.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "# Title\n\nExtracted text" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const ocr = new DeepSeekSelfHostedOCR({ vllmUrl: "http://fake:8000", preserveTables: true, includeImages: true, mode: "accurate" });
      const available = await ocr.isAvailable();
      expect(available).toBe(true);
      const fake = path.join("/tmp", "test.png");
      await fs.writeFile(fake, Buffer.from("fake"));
      const result = await ocr.processFile(fake);
      expect(result.markdown).toContain("Title");
      expect(result.provider).toBe("deepseek-ocr");
      await fs.unlink(fake).catch(() => {});
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("1.4 processFile() parsea markdown con tablas", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/health")) return new Response("ok", { status: 200 });
      if (url.includes("/v1/chat/completions")) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "# T\n\n| A | B |\n|---|---|\n| 1 | 2 |" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const ocr = new DeepSeekSelfHostedOCR({ vllmUrl: "http://fake:8000", preserveTables: true, includeImages: true, mode: "accurate" });
      const fake = path.join("/tmp", "test.png");
      await fs.writeFile(fake, Buffer.from("fake"));
      const result = await ocr.processFile(fake);
      expect(result.hasTables).toBe(true);
      await fs.unlink(fake).catch(() => {});
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
