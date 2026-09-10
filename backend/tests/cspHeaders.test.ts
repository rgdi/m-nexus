// cspHeaders.test.ts: tests de CSP headers (v0.60 P3.3)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerCspHeaders } from "../src/middleware/cspHeaders.js";

describe("CspHeaders (P3.3)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    registerCspHeaders(app, { strict: false, extraConnectSrc: [] });
    app.get("/test", async () => ({ ok: true }));
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("anade CSP header", async () => {
    const r = await app.inject({ method: "GET", url: "/test" });
    expect(r.headers["content-security-policy"]).toBeDefined();
    expect(r.headers["content-security-policy"]).toContain("default-src");
  });
  it("anade X-Content-Type-Options", async () => {
    const r = await app.inject({ method: "GET", url: "/test" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("anade X-Frame-Options", async () => {
    const r = await app.inject({ method: "GET", url: "/test" });
    expect(r.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
  it("anade Referrer-Policy", async () => {
    const r = await app.inject({ method: "GET", url: "/test" });
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
  });
  it("anade Permissions-Policy", async () => {
    const r = await app.inject({ method: "GET", url: "/test" });
    expect(r.headers["permissions-policy"]).toBeDefined();
  });
  it("anade HSTS", async () => {
    const r = await app.inject({ method: "GET", url: "/test" });
    expect(r.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("modo strict: frame-ancestors 'none'", async () => {
    const a2 = Fastify();
    registerCspHeaders(a2, { strict: true });
    a2.get("/x", async () => ({ ok: true }));
    await a2.ready();
    const r = await a2.inject({ method: "GET", url: "/x" });
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    await a2.close();
  });

  it("extraConnectSrc se anade", async () => {
    const a3 = Fastify();
    registerCspHeaders(a3, { extraConnectSrc: ["https://api.example.com"] });
    a3.get("/x", async () => ({ ok: true }));
    await a3.ready();
    const r = await a3.inject({ method: "GET", url: "/x" });
    expect(r.headers["content-security-policy"]).toContain("https://api.example.com");
    await a3.close();
  });

  it("respeta header ya seteado por ruta", async () => {
    const a4 = Fastify();
    registerCspHeaders(a4);
    a4.get("/x", async (_req, reply) => {
      reply.header("content-security-policy", "default-src 'none'");
      return { ok: true };
    });
    await a4.ready();
    const r = await a4.inject({ method: "GET", url: "/x" });
    expect(r.headers["content-security-policy"]).toBe("default-src 'none'");
    await a4.close();
  });
});
