// Tests de integración: endpoints /metrics y /api/v1/llm/embed/cache.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/server.js";
import { EmbeddingsService } from "../src/services/embeddings.js";
import { signAccessToken } from "../src/auth/jwt.js";
import { registerDevice } from "../src/auth/devices.js";
import { getMetrics } from "../src/utils/metrics.js";
import type { FastifyInstance } from "fastify";

describe("HTTP /metrics", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "true";
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
    registerDevice("metrics-test", { deviceName: "Test" });
    token = signAccessToken("metrics-test").token;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Resetear el singleton de metrics para tests deterministas
    EmbeddingsService.resetCache();
  });

  it("GET /metrics devuelve texto Prometheus", async () => {
    const r = await fetch(`${baseUrl}/metrics`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/plain");
    const text = await r.text();
    expect(text).toContain("# HELP mnexus_http_requests_total");
    expect(text).toContain("# TYPE mnexus_http_requests_total counter");
  });

  it("incluye gauges derivados (active devices, cache size)", async () => {
    const r = await fetch(`${baseUrl}/metrics`);
    const text = await r.text();
    expect(text).toMatch(/mnexus_active_devices \d+/);
    expect(text).toMatch(/mnexus_process_uptime_seconds \d+/);
  });

  it("un embed incrementa counters de cache", async () => {
    // Reset metrics
    const m = getMetrics();
    m.incCounter("mnexus_embeddings_cache_misses_total", {}, 0);
    m.incCounter("mnexus_embeddings_cache_hits_total", {}, 0);
    // 1er embed
    const r1 = await fetch(`${baseUrl}/api/v1/llm/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texts: ["x" + Date.now()] }),
    });
    expect(r1.status).toBe(200);
    const before = await (await fetch(`${baseUrl}/metrics`)).text();
    // 2do embed (mismo texto → hit)
    const r2 = await fetch(`${baseUrl}/api/v1/llm/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texts: [JSON.parse(await r1.text()).embeddings ? "reuse" : "x" + Date.now()] }),
    });
    // Re-fetch del primer texto
    const r3 = await fetch(`${baseUrl}/api/v1/llm/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texts: ["x" + Date.now()] }),
    });
    const after = await (await fetch(`${baseUrl}/metrics`)).text();
    // Buscar contadores
    expect(after).toMatch(/mnexus_embeddings_cache_misses_total \d+/);
    expect(after).toMatch(/mnexus_embeddings_cache_hits_total \d+/);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
  });
});

describe("HTTP /api/v1/llm/embed/cache", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "true";
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
    registerDevice("cache-admin-test", { deviceName: "Cache Admin" });
    token = signAccessToken("cache-admin-test").token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /embed/cache devuelve stats", async () => {
    const r = await fetch(`${baseUrl}/api/v1/llm/embed/cache`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    const data = await r.json() as { stats: { size: number; maxSize: number; hitRate: number } };
    expect(data.stats.maxSize).toBeGreaterThan(0);
    expect(data.stats.hitRate).toBeGreaterThanOrEqual(0);
  });

  it("POST /embed/cache/clear con model limpia", async () => {
    // Llenar cache
    await fetch(`${baseUrl}/api/v1/llm/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ texts: ["x-clear-1"], model: "clear-test" }),
    });
    const r = await fetch(`${baseUrl}/api/v1/llm/embed/cache/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "clear-test" }),
    });
    expect(r.status).toBe(200);
    const data = await r.json() as { ok: boolean; removed: number };
    expect(data.ok).toBe(true);
    expect(data.removed).toBeGreaterThan(0);
  });
});
