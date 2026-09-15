// cross_verify.test.ts — verifica el cruce notas↔grabaciones (v1.5.6)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

let app: Awaited<ReturnType<typeof buildServer>>;
const REC_FILE = join(process.cwd(), "data", "recordings.json");
const NOTE_FILE = join(process.cwd(), "data", "notes.json");

beforeAll(async () => {
  try { await fs.unlink(REC_FILE); } catch {}
  try { await fs.unlink(NOTE_FILE); } catch {}
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  try { await fs.unlink(REC_FILE); } catch {}
});

describe("Cross-verify v1.5.6", () => {
  it("GET /api/v1/cross-verify devuelve coverage 100% sin grabaciones", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/cross-verify" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coveragePct).toBe(100);
    expect(body.totalRecordings).toBe(0);
  });

  it("Graba sin nota → gap missing-notes", async () => {
    // 1. crear nota en math
    const note = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      payload: { title: "Math", subject: "math", body: "x" },
    });
    expect(note.statusCode).toBe(201);

    // 2. crear grabación en "physics" (sin notas)
    const rec = await app.inject({
      method: "POST",
      url: "/api/v1/recordings",
      payload: { subject: "physics", subjectName: "Physics", durationSec: 300, sizeBytes: 1000 },
    });
    expect(rec.statusCode).toBe(201);

    // 3. cross-verify subject=physics
    const cv = await app.inject({ method: "GET", url: "/api/v1/cross-verify?subject=physics" });
    const body = cv.json();
    expect(body.totalRecordings).toBe(1);
    const missing = body.gaps.find((g: any) => g.type === "missing-notes");
    expect(missing).toBeTruthy();
  });

  it("POST /api/v1/recordings persiste y GET /api/v1/recordings lista", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/recordings",
      payload: { subject: "math", subjectName: "Math", durationSec: 120, sizeBytes: 500, transcript: "test" },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await app.inject({ method: "GET", url: "/api/v1/recordings" });
    expect(list.statusCode).toBe(200);
    const all = list.json();
    expect(all.recordings.find((r: any) => r.id === id)).toBeTruthy();
    expect(all.recordings.find((r: any) => r.id === id).transcript).toBe("test");
  });

  it("DELETE /api/v1/recordings/:id elimina", async () => {
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/recordings",
      payload: { subject: "x", subjectName: "X", durationSec: 1 },
    });
    const id = c.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/recordings/${id}` });
    expect(del.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: `/api/v1/recordings` });
    expect(get.json().recordings.find((r: any) => r.id === id)).toBeUndefined();
  });
});
