import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server.js";
import { signAccessToken } from "../src/auth/jwt.js";
import { registerDevice } from "../src/auth/devices.js";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";

describe("WebSocket /api/v1/audio/transcribe/stream", () => {
  let app: FastifyInstance;
  let wsUrl: string;
  let port: number;
  let validToken: string;

  beforeAll(async () => {
    // WS tests: con auth (probar token inválido y válido)
    process.env.AUTH_REQUIRED = "true";
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "object" && addr) port = addr.port;
    wsUrl = `ws://127.0.0.1:${port}/api/v1/audio/transcribe/stream`;
    // Registrar y obtener token
    registerDevice("ws-test-device", { deviceName: "WS Test" });
    const t = signAccessToken("ws-test-device");
    validToken = t.token;
  });

  afterAll(async () => {
    await app.close();
  });

  function openSocket(token?: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const url = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
      const ws = new WebSocket(url);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout esperando mensaje")), timeoutMs);
      const handler = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (predicate(msg)) {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve(msg);
          }
        } catch (e) {
          // ignorar
        }
      };
      ws.on("message", handler);
    });
  }

  it("acepta start, audio, end y devuelve final (con JWT)", async () => {
    const ws = await openSocket(validToken);
    const readyPromise = waitForMessage(ws, (m) => m.type === "ready");
    ws.send(JSON.stringify({ type: "start", language: "es", model: "base" }));
    await readyPromise;

    const finalPromise = waitForMessage(ws, (m) => m.type === "final");
    const audio = Buffer.from("fake-audio-32kb-blob").toString("base64");
    ws.send(JSON.stringify({ type: "audio", data: audio }));
    ws.send(JSON.stringify({ type: "audio", data: audio }));
    ws.send(JSON.stringify({ type: "end" }));
    const final = await finalPromise;
    expect(final.text).toBeTruthy();
    expect(final.language).toBe("es");
    expect(final.durationSec).toBeGreaterThan(0);
    ws.close();
  });

  it("rechaza sin token", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
    });
    // Si llegó a cerrarse por el servidor, OK
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it("rechaza token inválido", async () => {
    const ws = new WebSocket(`${wsUrl}?token=invalid.token.here`);
    await new Promise<void>((resolve) => {
      ws.on("close", () => resolve());
      ws.on("error", () => resolve());
    });
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  it("maneja JSON inválido con error message", async () => {
    const ws = await openSocket(validToken);
    const errorPromise = waitForMessage(ws, (m) => m.type === "error");
    ws.send("esto no es json");
    const err = await errorPromise;
    expect(err.message).toContain("Invalid JSON");
    ws.close();
  });
});
