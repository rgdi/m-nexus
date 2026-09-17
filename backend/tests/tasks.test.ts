// tasks.test.ts: tests de /api/v1/tasks (to-do's)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: FastifyInstance;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "tsk-"));
  process.chdir(tmpDir);
  process.env.LAN_AUTH_BYPASS = "true";
  app = Fastify();
  app.setErrorHandler((err, _req, reply) => {
    reply.status((err as any).statusCode ?? 500).send({ error: err.message, code: (err as any).code });
  });
  const { tasksRoutes } = await import("../src/routes/tasks.js");
  const { adminRoutes } = await import("../src/routes/admin.js");
  await app.register(tasksRoutes, { prefix: "/api/v1" });
  await app.register(adminRoutes, { prefix: "/api/v1" });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  process.chdir(__dirname + "/..");
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Tasks CRUD", () => {
  it("seed devuelve 6 tasks", async () => {
    // v2.6.0: demo data is opt-in
    await app.inject({ method: "POST", url: "/api/v1/admin/demo/load" });
    const r = await app.inject({ method: "GET", url: "/api/v1/tasks" });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(6);
  });

  it("POST crea task", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks",
      payload: { text: "New task", priority: 1, subject: "math" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().done).toBe(false);
  });

  it("POST sin text -> 400", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/tasks", payload: {} });
    expect(r.statusCode).toBe(400);
  });

  it("PATCH marca done", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/tasks" })).json().tasks;
    const target = list.find((t: any) => !t.done);
    const r = await app.inject({
      method: "PATCH", url: `/api/v1/tasks/${target.id}`,
      payload: { done: true },
    });
    expect(r.json().done).toBe(true);
  });

  it("POST /toggle invierte done", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/v1/tasks" })).json().tasks;
    const target = list[0];
    const before = target.done;
    const r = await app.inject({ method: "POST", url: `/api/v1/tasks/${target.id}/toggle` });
    expect(r.json().done).toBe(!before);
  });

  it("DELETE borra", async () => {
    const c = await app.inject({ method: "POST", url: "/api/v1/tasks", payload: { text: "tmp" } });
    const id = c.json().id;
    const d = await app.inject({ method: "DELETE", url: `/api/v1/tasks/${id}` });
    expect(d.statusCode).toBe(200);
  });
});
