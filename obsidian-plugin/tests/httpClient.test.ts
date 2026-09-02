// Tests del HTTPClient con auto-refresh de JWT.
// Mockeamos fetch global con una pila de respuestas.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HTTPClient } from "../src/server/httpClient";
import { createMemoryTokenStore, type StoredTokens } from "../src/server/tokenStore";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

interface MockResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

let requests: RecordedRequest[] = [];
let responses: Array<MockResponse> = [];

function queueResponse(r: MockResponse) {
  responses.push(r);
}

beforeEach(() => {
  requests = [];
  responses = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => { headers[k] = v; });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else {
        Object.assign(headers, h as Record<string, string>);
      }
    }
    requests.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body: init?.body as string | undefined,
    });
    const r = responses.shift();
    if (!r) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", ...(r.headers ?? {}) } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeClient(): HTTPClient {
  return new HTTPClient({
    baseUrl: "http://api",
    deviceId: "dev-1",
    store: createMemoryTokenStore(),
  });
}

function makeClientWithTokens(): { client: HTTPClient; store: ReturnType<typeof createMemoryTokenStore> } {
  const store = createMemoryTokenStore();
  const tokens: StoredTokens = {
    deviceId: "dev-1",
    accessToken: "valid-access",
    refreshToken: "valid-refresh",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    serverVersion: "0.12.0",
  };
  store.save(tokens);
  const client = new HTTPClient({
    baseUrl: "http://api",
    deviceId: "dev-1",
    store,
  });
  return { client, store };
}

function tokenPayload(access = "new-access", refresh = "new-refresh") {
  return JSON.stringify({
    accessToken: access,
    refreshToken: refresh,
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
  });
}

describe("HTTPClient", () => {
  it("register: si no hay tokens, llama a /register y guarda", async () => {
    queueResponse({ status: 200, body: tokenPayload() });
    const c = makeClient();
    await c.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(requests[0].url).toContain("/api/v1/register");
  });

  it("si hay tokens, no vuelve a registrar", async () => {
    const { client } = makeClientWithTokens();
    queueResponse({ status: 200, body: "{}" });
    await client.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(requests[0].url).toContain("/api/v1/llm/chat");
    expect(requests[0].url).not.toContain("/register");
  });

  it("envía Authorization: Bearer con el access token", async () => {
    const { client } = makeClientWithTokens();
    queueResponse({ status: 200, body: "{}" });
    await client.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(requests[0].headers["Authorization"]).toBe("Bearer valid-access");
  });

  it("401 dispara refresh y retry con nuevo token", async () => {
    const { client, store } = makeClientWithTokens();
    queueResponse({ status: 401, body: JSON.stringify({ code: "UNAUTHORIZED" }) });
    queueResponse({ status: 200, body: tokenPayload("new-access-2", "new-refresh-2") });
    queueResponse({ status: 200, body: '{"ok":true}' });

    const r = await client.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(r).toEqual({ ok: true });
    expect(requests).toHaveLength(3); // chat, refresh, chat
    expect(requests[0].url).toContain("/api/v1/llm/chat");
    expect(requests[1].url).toContain("/api/v1/auth/refresh");
    expect(requests[2].url).toContain("/api/v1/llm/chat");
    expect(requests[2].headers["Authorization"]).toBe("Bearer new-access-2");
    expect(store.load()?.accessToken).toBe("new-access-2");
  });

  it("refresh inválido: vuelve a registrar", async () => {
    const { client } = makeClientWithTokens();
    queueResponse({ status: 401, body: "{}" }); // chat 401
    queueResponse({ status: 401, body: "{}" }); // refresh falla
    queueResponse({ status: 200, body: tokenPayload("re-registered") }); // register OK
    queueResponse({ status: 200, body: '{"ok":true}' }); // retry chat

    const r = await client.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(r).toEqual({ ok: true });
    expect(requests).toHaveLength(4);
    expect(requests[2].url).toContain("/api/v1/register");
  });

  it("access por expirar (<60s) se refresca proactivamente", async () => {
    const { client } = makeClientWithTokens();
    const store = (client as unknown as { opts: { store: ReturnType<typeof createMemoryTokenStore> } }).opts.store;
    const t = store.load()!;
    t.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + 30;
    store.save(t);

    queueResponse({ status: 200, body: tokenPayload("refreshed-access") });
    queueResponse({ status: 200, body: '{"ok":true}' });

    await client.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    // 1ª call: refresh
    expect(requests[0].url).toContain("/api/v1/auth/refresh");
    // 2ª call: chat con nuevo token
    expect(requests[1].url).toContain("/api/v1/llm/chat");
    expect(requests[1].headers["Authorization"]).toBe("Bearer refreshed-access");
  });

  it("legacyToken: si está, se usa como access (migración v0.11)", async () => {
    const c = new HTTPClient({
      baseUrl: "http://api",
      deviceId: "dev-1",
      legacyToken: "old-v011-token",
      store: createMemoryTokenStore(),
    });
    queueResponse({ status: 200, body: '{"ok":true}' });
    await c.fetchJSON("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(requests[0].headers["Authorization"]).toBe("Bearer old-v011-token");
  });

  it("skipAuth: no añade Authorization", async () => {
    const { client } = makeClientWithTokens();
    queueResponse({ status: 200, body: "{}" });
    await client.fetch("/api/v1/auth/refresh", { method: "POST", body: "{}", skipAuth: true });
    expect(requests[0].headers["Authorization"]).toBeUndefined();
  });

  it("error 500 no se reintenta con refresh", async () => {
    const { client } = makeClientWithTokens();
    queueResponse({ status: 500, body: '{"error":"boom"}' });
    const r = await client.fetch("/api/v1/llm/chat", { method: "POST", body: "{}" });
    expect(r.status).toBe(500);
    expect(requests).toHaveLength(1);
  });
});
