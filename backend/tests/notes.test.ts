// notes.test.ts: tests de /api/v1/notes (notebooks con pages y strokes)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "notes-"));
  process.chdir(tmpDir);
  process.env.LAN_AUTH_BYPASS = "true";
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    reply.status((err as any).statusCode ?? 500).send({ error: err.message, code: (err as any).code });
  });
  const { notesRoutes } = await import("../src/routes/notes.js");
  const { adminRoutes } = await import("../src/routes/admin.js");
  await app.register(notesRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  process.chdir(__dirname + "/..");
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Notes CRUD", () => {
  it("seed devuelve 3 notebooks", async () => {
    // v2.6.0: demo data is opt-in
    await app.inject({ method: "POST", url: "/api/v1/admin/demo/load" });
    const r = await app.inject({ method: "GET", url: "/api/v1/notes" });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(3);
  });

  it("POST crea notebook", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/notes",
      payload: { title: "Test note", subject: "math", body: "# hello" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().pages.length).toBe(1);
  });

  it("PATCH actualiza title", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/notes" })).json().notes;
    const r = await app.inject({
      method: "PATCH", url: `/api/v1/notes/${list[0].id}`,
      payload: { title: "New title" },
    });
    expect(r.json().title).toBe("New title");
  });

  it("POST stroke append a una página", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/notes" })).json().notes;
    const note = list[0];
    const r = await app.inject({
      method: "POST", url: `/api/v1/notes/${note.id}/pages/0/strokes`,
      payload: { stroke: { tool: "pen", color: "#000", size: 3, alpha: 1, points: [{ x: 10, y: 10, p: 0.5, tilt: 0 }, { x: 50, y: 50, p: 0.5, tilt: 0 }] } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().strokeCount).toBeGreaterThan(0);
  });

  it("DELETE borra notebook", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/notes", payload: { title: "Tmp" } });
    const id = c.json().id;
    const d = await app.inject({ method: "DELETE", url: `/api/v1/notes/${id}` });
    expect(d.statusCode).toBe(200);
  });

  it("GET id inexistente -> 404", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/notes/no-existe" });
    expect(r.statusCode).toBe(404);
  });
});
