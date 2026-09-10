// handwriting.test.ts: tests de handwriting recognition (v0.60 P2.2)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { getHandwritingService } from "../src/services/handwritingService.js";

describe("HandwritingService (P2.2)", () => {
  it("devuelve empty para strokes vacios", async () => {
    const svc = getHandwritingService();
    const r = await svc.recognize([]);
    expect(r.text).toBe("");
    expect(r.words).toHaveLength(0);
  });
  it("devuelve empty para un solo stroke", async () => {
    const svc = getHandwritingService();
    const r = await svc.recognize([{ x: 0, y: 0, t: 0 }]);
    expect(r.text).toBe("");
  });
  it("reconoce un par de strokes como 'palabra'", async () => {
    const svc = getHandwritingService();
    const r = await svc.recognize([
      { x: 10, y: 10, t: 0 },
      { x: 20, y: 15, t: 50 },
      { x: 30, y: 20, t: 100 },
    ]);
    expect(r.words.length).toBeGreaterThan(0);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(["tesseract", "heuristic", "hybrid"]).toContain(r.source);
  });
  it("detecta gaps temporales entre palabras", async () => {
    const svc = getHandwritingService();
    const r = await svc.recognize([
      { x: 10, y: 10, t: 0 },
      { x: 20, y: 15, t: 50 },
      // gap 500ms
      { x: 50, y: 10, t: 600 },
      { x: 60, y: 15, t: 650 },
    ]);
    expect(r.words.length).toBe(2);
  });
});

describe("Handwriting HTTP routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const { handwritingRoutes } = await import("../src/routes/handwriting.js");
    await app.register(handwritingRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("POST strokes validos", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/handwriting/recognize",
      payload: { strokes: [{ x: 0, y: 0, t: 0 }, { x: 10, y: 10, t: 100 }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().source).toBeDefined();
  });
  it("POST strokes vacios -> 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/handwriting/recognize",
      payload: { strokes: [] },
    });
    expect(r.statusCode).toBe(400);
  });
  it("POST stroke invalido -> 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/handwriting/recognize",
      payload: { strokes: [{ x: 0, y: 0 }] },
    });
    expect(r.statusCode).toBe(400);
  });
  it("GET info", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/handwriting/info" });
    expect(r.statusCode).toBe(200);
    expect(r.json().requiredFields).toEqual(["x", "y", "t"]);
  });
});
