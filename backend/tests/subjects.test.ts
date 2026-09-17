// subjects.test.ts: tests de /api/v1/subjects
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "subj-"));
  process.chdir(tmpDir);
  process.env.LAN_AUTH_BYPASS = "true";
  // Reset cache require
  delete require.cache[require.resolve("../src/routes/subjects.ts")];
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    reply.status((err as any).statusCode ?? 500).send({ error: err.message, code: (err as any).code });
  });
  const { subjectsRoutes } = await import("../src/routes/subjects.js");
  const { adminRoutes } = await import("../src/routes/admin.js");
  await app.register(subjectsRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  process.chdir(__dirname + "/..");
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Subjects CRUD", () => {
  it("seed devuelve 12 subjects", async () => {
    // v2.6.0: demo data is opt-in
    await app.inject({ method: "POST", url: "/api/v1/admin/demo/load" });
    const r = await app.inject({ method: "GET", url: "/api/v1/subjects" });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(12);
  });
  it("GET /subjects/:id devuelve Math", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/subjects" });
    const math = r.json().subjects.find((s: any) => s.name === "Math");
    expect(math).toBeDefined();
    const r2 = await app.inject({ method: "GET", url: `/api/v1/subjects/${math.id}` });
    expect(r2.json().icon).toBe("M");
  });
  it("POST crea un subject nuevo", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/subjects",
      payload: { name: "Latin", icon: "L", color: "var(--subj-yellow)", grade: 6.5 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().name).toBe("Latin");
  });
  it("POST sin name -> 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/subjects", payload: {} });
    expect(r.statusCode).toBe(400);
  });
  it("PATCH actualiza grade", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/subjects" })).json().subjects;
    const target = list[0];
    const r = await app.inject({
      method: "PATCH", url: `/api/v1/subjects/${target.id}`,
      payload: { grade: 8.5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().grade).toBe(8.5);
  });
  it("DELETE borra", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/subjects", payload: { name: "ToDelete" } });
    const id = r.json().id;
    const d = await app.inject({ method: "DELETE", url: `/api/v1/subjects/${id}` });
    expect(d.statusCode).toBe(200);
    const g = await app.inject({ method: "GET", url: `/api/v1/subjects/${id}` });
    expect(g.statusCode).toBe(404);
  });
  it("GET id inexistente -> 404", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/subjects/no-existe" });
    expect(r.statusCode).toBe(404);
  });
});
