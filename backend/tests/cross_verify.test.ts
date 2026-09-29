// cross_verify.test.ts — verifica el cruce notas↔grabaciones (v1.5.6)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { registerDevice, type TestAuth } from "./helpers/auth.js";

let app: Awaited<ReturnType<typeof buildServer>>;
// v2.37.0: notes + flashcards are no longer public routes.
let auth: TestAuth;
// v2.38.2: recordings are per user, so the test clears the caller's
// copy rather than a global path that no longer receives writes.
const REC_FILE = join(process.cwd(), "data", "users", "default", "recordings.json");
const NOTE_FILE = join(process.cwd(), "data", "notes.json");

beforeAll(async () => {
  try { await fs.unlink(REC_FILE); } catch {}
  try { await fs.unlink(NOTE_FILE); } catch {}
  app = await buildServer();
  auth = await registerDevice(app);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  try { await fs.unlink(REC_FILE); } catch {}
});

describe("Cross-verify v1.5.6", () => {
  it("GET /api/v1/cross-verify devuelve coverage 100% sin grabaciones", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/cross-verify", headers: auth.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.coveragePct).toBe(100);
    expect(body.totalRecordings).toBe(0);
  });

  it("Graba sin nota → gap missing-notes", async () => {
    // 1. crear nota en math
    const note = await app.inject({
      method: "POST",
      url: "/api/v1/notes", headers: auth.headers,
      payload: { title: "Math", subject: "math", body: "x" },
    });
    expect(note.statusCode).toBe(201);

    // 2. crear grabación en "physics" (sin notas)
    const rec = await app.inject({
      method: "POST",
      url: "/api/v1/recordings", headers: auth.headers,
      payload: { subject: "physics", subjectName: "Physics", durationSec: 300, sizeBytes: 1000 },
    });
    expect(rec.statusCode).toBe(201);

    // 3. cross-verify subject=physics
    const cv = await app.inject({ method: "GET", url: "/api/v1/cross-verify?subject=physics", headers: auth.headers });
    const body = cv.json();
    expect(body.totalRecordings).toBe(1);
    const missing = body.gaps.find((g: any) => g.type === "missing-notes");
    expect(missing).toBeTruthy();
  });

  it("POST /api/v1/recordings persiste y GET /api/v1/recordings lista", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/recordings", headers: auth.headers,
      payload: { subject: "math", subjectName: "Math", durationSec: 120, sizeBytes: 500, transcript: "test" },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await app.inject({ method: "GET", url: "/api/v1/recordings", headers: auth.headers });
    expect(list.statusCode).toBe(200);
    const all = list.json();
    expect(all.recordings.find((r: any) => r.id === id)).toBeTruthy();
    expect(all.recordings.find((r: any) => r.id === id).transcript).toBe("test");
  });

  it("DELETE /api/v1/recordings/:id elimina", async () => {
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/recordings", headers: auth.headers,
      payload: { subject: "x", subjectName: "X", durationSec: 1 },
    });
    const id = c.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/recordings/${id}`, headers: auth.headers });
    expect(del.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: `/api/v1/recordings`, headers: auth.headers });
    expect(get.json().recordings.find((r: any) => r.id === id)).toBeUndefined();
  });

  it("v1.6.3: book-refs generan jumpUrl con timestamp", async () => {
    const now = Date.now();
    // Crear grabación
    const rec = await app.inject({
      method: "POST",
      url: "/api/v1/recordings", headers: auth.headers,
      payload: { subject: "lit", subjectName: "Literature", durationSec: 600, createdAt: now },
    });
    expect(rec.statusCode).toBe(201);
    // Crear nota con @book/ref 90 segundos después
    const note = await app.inject({
      method: "POST",
      url: "/api/v1/notes", headers: auth.headers,
      payload: {
        title: "Don Quixote",
        subject: "lit",
        body: "@cervantes/cap1 and @cervantes/cap3",
        updatedAt: now + 90 * 1000,
      },
    });
    expect(note.statusCode).toBe(201);
    const cv = await app.inject({ method: "GET", url: "/api/v1/cross-verify?subject=lit", headers: auth.headers });
    const body = cv.json();
    const bookRefs = body.gaps.filter((g: any) => g.type === "book-ref");
    expect(bookRefs.length).toBe(2);
    expect(bookRefs[0].bookRef).toMatch(/^cervantes\/cap\d$/);
    expect(bookRefs[0].jumpUrl).toMatch(/^#\/notes\/.+\?rec=.+&t=\d+&ref=cervantes%2Fcap\d$/);
    expect(bookRefs[0].timestampFormatted).toMatch(/^0[01]:\d\d$/); // 0X:XX (90s = 01:30)
  });
});
