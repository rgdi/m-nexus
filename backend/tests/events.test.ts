// events.test.ts: tests de /api/v1/events (calendar)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "evt-"));
  process.chdir(tmpDir);
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    reply.status((err as any).statusCode ?? 500).send({ error: err.message, code: (err as any).code });
  });
  const { eventsRoutes } = await import("../src/routes/events.js");
  await app.register(eventsRoutes, { prefix: "/api/v1" });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  process.chdir(__dirname + "/..");
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Events CRUD", () => {
  it("seed devuelve 5 eventos", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/events" });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(5);
  });

  it("GET con rango from/to filtra", async () => {
    const now = Date.now();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/events?from=${now - 86400000}&to=${now + 86400000}`,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(5);
  });

  it("POST crea evento", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/events",
      payload: { title: "Bio exam", prof: "Dr X", room: "A1", type: "Exam", subject: "bio", start: Date.now() + 7 * 86400000, end: Date.now() + 7 * 86400000 + 3600000 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().title).toBe("Bio exam");
  });

  it("POST sin title -> 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/events",
      payload: { start: Date.now(), end: Date.now() + 3600000 },
    });
    expect(r.statusCode).toBe(400);
  });

  it("PATCH reagenda evento", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/events" })).json().events;
    const target = list[0];
    const newStart = Date.now() + 3 * 86400000;
    const newEnd = newStart + 3600000;
    const r = await app.inject({
      method: "PATCH", url: `/api/v1/events/${target.id}`,
      payload: { start: newStart, end: newEnd },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().start).toBe(newStart);
  });

  it("DELETE borra", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/events", payload: { title: "tmp", start: Date.now(), end: Date.now() + 3600000 } });
    const id = c.json().id;
    const d = await app.inject({ method: "DELETE", url: `/api/v1/events/${id}` });
    expect(d.statusCode).toBe(200);
  });
});
