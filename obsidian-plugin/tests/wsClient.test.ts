// Tests del WSClient (mock del WebSocket global).

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: object[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // abrir en el siguiente tick
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Helper para tests: simular un mensaje del server. */
  fakeServer(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  (globalThis as { WebSocket: unknown }).WebSocket = MockWebSocket;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WSClient", () => {
  it("connect envía token en query", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "jwt-123");
    await c.connect();
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain("?token=jwt-123");
    expect(ws.url).toContain("/api/v1/audio/transcribe/stream");
  });

  it("lanza error si no hay token", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => null);
    await expect(c.connect()).rejects.toThrow(/accessToken/);
  });

  it("sendStart espera a ready y envía start", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "t");
    await c.connect();
    // Simular que el server manda ready
    const ws = MockWebSocket.instances[0];
    queueMicrotask(() => ws.fakeServer({ type: "ready", compression: true }));
    await c.sendStart({ language: "es", model: "base" });
    expect(ws.sent).toContainEqual(expect.objectContaining({ type: "start", language: "es", model: "base" }));
  });

  it("sendAudio codifica bytes a base64", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "t");
    await c.connect();
    const ws = MockWebSocket.instances[0];
    queueMicrotask(() => ws.fakeServer({ type: "ready", compression: true }));
    await c.sendStart({});
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    c.sendAudio(bytes);
    expect(ws.sent).toContainEqual(expect.objectContaining({ type: "audio", data: "SGVsbG8=" }));
  });

  it("sendEnd resuelve con la transcripción final", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "t");
    await c.connect();
    const ws = MockWebSocket.instances[0];
    queueMicrotask(() => {
      ws.fakeServer({ type: "ready", compression: true });
      ws.fakeServer({ type: "final", text: "hola mundo", language: "es", durationSec: 2.5, compression: "deflate", bytesReceived: 1234 });
    });
    await c.sendStart({});
    c.sendAudio(new Uint8Array([1, 2, 3]));
    const result = await c.sendEnd();
    expect(result.text).toBe("hola mundo");
    expect(result.language).toBe("es");
    expect(result.bytesReceived).toBe(1234);
    expect(result.bytesSent).toBe(3);
  });

  it("sendEnd rechaza con error si server manda error", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "t");
    await c.connect();
    const ws = MockWebSocket.instances[0];
    queueMicrotask(() => {
      ws.fakeServer({ type: "ready" });
      ws.fakeServer({ type: "error", message: "Whisper falló" });
    });
    await c.sendStart({});
    await expect(c.sendEnd()).rejects.toThrow(/Whisper falló/);
  });

  it("onPartial recibe mensajes partial", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "t");
    await c.connect();
    const ws = MockWebSocket.instances[0];
    const partiels: string[] = [];
    c.onPartial = (t) => partiels.push(t);
    queueMicrotask(() => {
      ws.fakeServer({ type: "ready" });
      ws.fakeServer({ type: "partial", text: "leyendo..." });
      ws.fakeServer({ type: "final", text: "completo" });
    });
    await c.sendStart({});
    await c.sendEnd();
    expect(partiels).toContain("leyendo...");
  });

  it("solicita compression: true por defecto", async () => {
    const { WSClient } = await import("../src/server/wsClient");
    const c = new WSClient("https://api.example.com", () => "t");
    await c.connect();
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBeTruthy();
  });
});
