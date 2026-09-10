// perUserRateLimit.test.ts: tests del rate limit por usuario (v0.60 P3.2)
import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPerUserRateLimit, __resetBuckets } from "../src/middleware/perUserRateLimit.js";

describe("PerUserRateLimit (P3.2)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    __resetBuckets();
    app = Fastify();
    registerPerUserRateLimit(app, {
      perMinute: 10,
      burstPerSecond: 10,
      getUserId: (req) => (req.headers["x-user-id"] as string) ?? null,
    });
    app.get("/test", async () => ({ ok: true }));
    await app.ready();
  });

  it("permite hasta el limite", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "GET", url: "/test", headers: { "x-user-id": "u1" } });
      expect(r.statusCode).toBe(200);
    }
  });
  it("bloquea despues del limite", async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: "GET", url: "/test", headers: { "x-user-id": "u1" } });
    }
    const r = await app.inject({ method: "GET", url: "/test", headers: { "x-user-id": "u1" } });
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBeDefined();
  });
  it("limites son POR usuario", async () => {
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: "GET", url: "/test", headers: { "x-user-id": "u1" } });
    }
    // u1 bloqueado
    const r1 = await app.inject({ method: "GET", url: "/test", headers: { "x-user-id": "u1" } });
    expect(r1.statusCode).toBe(429);
    // u2 puede seguir
    const r2 = await app.inject({ method: "GET", url: "/test", headers: { "x-user-id": "u2" } });
    expect(r2.statusCode).toBe(200);
  });
  it("sin user no limita", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: "GET", url: "/test" });
      expect(r.statusCode).toBe(200);
    }
  });
});
