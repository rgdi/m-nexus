import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, VERSION } from "../src/server.js";
import type { FastifyInstance } from "fastify";

describe("M-NEXUS Backend API", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    // API tests: sin auth (probamos los endpoints, no la seguridad)
    process.env.AUTH_REQUIRED = "false";
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "object" && addr) {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/v1/health", () => {
    it("devuelve status, version, providers y uptime", async () => {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      expect(res.status).toBe(200);
      const data = await res.json() as {
        status: string;
        version: string;
        providers: Record<string, string>;
        mock: Record<string, boolean>;
        uptimeSec: number;
      };
      expect(data.version).toBe(VERSION);
      expect(typeof data.uptimeSec).toBe("number");
      expect(data.providers).toHaveProperty("whisper");
      expect(data.providers).toHaveProperty("ollama");
      expect(data.providers).toHaveProperty("tesseract");
    });

    it("marca providers como 'available' en modo MOCK", async () => {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      const data = await res.json() as { providers: Record<string, string>; mock: Record<string, boolean> };
      expect(data.providers.whisper).toBe("available");
      expect(data.providers.ollama).toBe("available");
      expect(data.providers.openrouter).toBe("available");
      expect(data.providers.tesseract).toBe("available");
      expect(data.mock.whisper).toBe(true);
    });
  });

  describe("POST /api/v1/register", () => {
    it("registra un device y devuelve access + refresh tokens", async () => {
      const res = await fetch(`${baseUrl}/api/v1/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "test-device-1",
          deviceName: "Test MacBook",
          platform: "macos",
          pluginVersion: "0.12.0",
          protocolVersion: "1.0.0",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as {
        accessToken: string;
        refreshToken: string;
        serverVersion: string;
        hasExistingState: boolean;
      };
      expect(data.accessToken).toBeTruthy();
      expect(data.refreshToken).toBeTruthy();
      expect(data.serverVersion).toBeTruthy();
      expect(typeof data.hasExistingState).toBe("boolean");
    });

    it("rechaza sin deviceId", async () => {
      const res = await fetch(`${baseUrl}/api/v1/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/devices", () => {
    it("devuelve la lista de devices registrados", async () => {
      // Registrar uno primero
      await fetch(`${baseUrl}/api/v1/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "device-for-list", deviceName: "List test" }),
      });
      const res = await fetch(`${baseUrl}/api/v1/devices`);
      expect(res.status).toBe(200);
      const data = await res.json() as { count: number; devices: Array<{ deviceId: string; deviceName: string }> };
      expect(data.count).toBeGreaterThan(0);
      const found = data.devices.find((d) => d.deviceId === "device-for-list");
      expect(found).toBeTruthy();
      expect(found?.deviceName).toBe("List test");
    });

    it("oculta tokens sensibles en la respuesta", async () => {
      await fetch(`${baseUrl}/api/v1/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "device-token-test" }),
      });
      const res = await fetch(`${baseUrl}/api/v1/devices`);
      const data = await res.json() as { devices: Array<{ deviceId: string; lastAccessTokenId?: string; publicKeyJwk?: unknown }> };
      const d = data.devices.find((x) => x.deviceId === "device-token-test");
      // Ningún token debe aparecer en texto claro
      expect(JSON.stringify(d)).not.toContain("eyJ"); // JWT no en claro
    });
  });

  describe("POST /api/v1/audio/transcribe", () => {
    it("transcribe audio (mock) y devuelve texto", async () => {
      const audio = Buffer.from("fake-audio-data-32kb").toString("base64");
      const res = await fetch(`${baseUrl}/api/v1/audio/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: audio, mimeType: "audio/mp3", language: "es" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { text: string; language: string; durationSec: number; segments: unknown[] };
      expect(data.text).toBeTruthy();
      expect(data.language).toBe("es");
      expect(data.durationSec).toBeGreaterThan(0);
      expect(Array.isArray(data.segments)).toBe(true);
    });

    it("rechaza sin audioBase64", async () => {
      const res = await fetch(`${baseUrl}/api/v1/audio/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/llm/chat", () => {
    it("responde a un chat (mock)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/llm/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hola" }],
          responseFormat: "text",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { content: string; model: string };
      expect(data.content).toContain("MOCK");
      expect(data.model).toBe("mock-llm");
    });

    it("modo JSON devuelve JSON parseable", async () => {
      const res = await fetch(`${baseUrl}/api/v1/llm/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "dame un json" }],
          responseFormat: "json",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { content: string };
      const parsed = JSON.parse(data.content);
      expect(parsed.mock).toBe(true);
    });

    it("rechaza sin messages", async () => {
      const res = await fetch(`${baseUrl}/api/v1/llm/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/llm/embed", () => {
    it("devuelve embeddings con dimensión fija", async () => {
      const res = await fetch(`${baseUrl}/api/v1/llm/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: ["hola", "adiós"] }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { embeddings: number[][]; model: string; dim: number };
      expect(data.embeddings).toHaveLength(2);
      expect(data.embeddings[0]).toHaveLength(data.dim);
      expect(data.dim).toBe(1024);
    });

    it("rechaza sin texts", async () => {
      const res = await fetch(`${baseUrl}/api/v1/llm/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/ocr/image", () => {
    it("reconoce texto en una imagen (mock)", async () => {
      const img = Buffer.from("fake-image-bytes-1kb").toString("base64");
      const res = await fetch(`${baseUrl}/api/v1/ocr/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: img }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { text: string; confidence: number; blocks: unknown[] };
      expect(data.text).toBeTruthy();
      expect(data.confidence).toBeGreaterThan(0);
      expect(Array.isArray(data.blocks)).toBe(true);
    });

    it("rechaza sin imageBase64", async () => {
      const res = await fetch(`${baseUrl}/api/v1/ocr/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/flashcards/generate", () => {
    it("genera borradores desde una nota (mock)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/flashcards/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteTitle: "Glucólisis",
          noteContent: "La glucólisis es la vía central del catabolismo de la glucosa...",
          style: "cloze",
          level: "1_MED",
          maxCards: 3,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { cards: Array<{ front: string; back: string; cardType: string }>; model: string };
      expect(Array.isArray(data.cards)).toBe(true);
      expect(data.model).toBe("mock-llm");
    });

    it("rechaza sin noteContent", async () => {
      const res = await fetch(`${baseUrl}/api/v1/flashcards/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/pdf/diff", () => {
    it("compara dos PDFs y devuelve diff (mock con texto extraído)", async () => {
      const pdfA = Buffer.from("Esto es un texto del primer PDF con palabras repetidas").toString("base64");
      const pdfB = Buffer.from("Esto es un texto del segundo PDF con palabras modificadas").toString("base64");
      const res = await fetch(`${baseUrl}/api/v1/pdf/diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfABase64: pdfA, pdfBBase64: pdfB }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as {
        summary: { equal: number; modified: number; added: number; removed: number; changeRatio: number };
        hunks: Array<{ kind: string; oldText?: string; newText?: string; similarity: number }>;
      };
      expect(data.summary).toHaveProperty("equal");
      expect(data.summary).toHaveProperty("changeRatio");
      expect(Array.isArray(data.hunks)).toBe(true);
    });

    it("rechaza sin pdfABase64 o pdfBBase64", async () => {
      const res = await fetch(`${baseUrl}/api/v1/pdf/diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/stats", () => {
    it("devuelve version, uptime y memory", async () => {
      const res = await fetch(`${baseUrl}/api/v1/stats`);
      expect(res.status).toBe(200);
      const data = await res.json() as { version: string; uptime: number; memory: { rss: number } };
      expect(data.version).toBe(VERSION);
      expect(data.uptime).toBeGreaterThan(0);
      expect(data.memory.rss).toBeGreaterThan(0);
    });
  });

  describe("GET / (dashboard)", () => {
    it("sirve el HTML del dashboard", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("M-NEXUS Backend");
      expect(html).toContain("Dashboard");
    });
  });
});
