// flashcards.test.ts — vitest backend tests (v1.5.1)
// Verifica CRUD + extracción desde body de notas.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

let app: Awaited<ReturnType<typeof buildServer>>;
const DATA_FILE = join(process.cwd(), "data", "flashcards.json");

beforeAll(async () => {
  try { await fs.unlink(DATA_FILE); } catch {}
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  try { await fs.unlink(DATA_FILE); } catch {}
});

describe("Flashcards CRUD v1.5.1", () => {
  it("GET /api/v1/flashcards returns empty list initially", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/flashcards" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cards).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("POST /api/v1/flashcards creates a card", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/flashcards",
      payload: { front: "Capital de Francia", back: "París", subject: "math", tags: ["geo"] },
    });
    expect(res.statusCode).toBe(201);
    const c = res.json();
    expect(c.front).toBe("Capital de Francia");
    expect(c.subject).toBe("math");
    expect(c.id).toMatch(/^fc-/);
  });

  it("GET /api/v1/flashcards/filter?subject=math filters by subject", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/flashcards/filter?subject=math" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    body.cards.forEach((c: any) => expect(c.subject).toBe("math"));
  });

  it("PATCH /api/v1/flashcards/:id updates front/back", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/flashcards",
      payload: { front: "q1", back: "a1", subject: "bio" },
    });
    const id = created.json().id;
    const upd = await app.inject({
      method: "PATCH",
      url: `/api/v1/flashcards/${id}`,
      payload: { back: "a1-updated" },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().back).toBe("a1-updated");
  });

  it("POST /api/v1/notes/:id/extract-flashcards parses {{c1::...::...}} and assigns subject+tags", async () => {
    const note = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      payload: {
        title: "Algebra",
        subject: "math",
        tags: ["algebra", "basics"],
        body: "Suma: {{c1::2+2::4}}\nProducto: {{c1::3*5::15}}",
      },
    });
    const noteId = note.json().id;
    const ext = await app.inject({
      method: "POST",
      url: `/api/v1/notes/${noteId}/extract-flashcards`,
    });
    expect(ext.statusCode).toBe(200);
    const out = ext.json();
    expect(out.created.length).toBe(2);
    expect(out.skipped).toBe(0);
    out.created.forEach((c: any) => {
      expect(c.subject).toBe("math");
      expect(c.tags).toEqual(["algebra", "basics"]);
      expect(c.sourceNoteId).toBe(noteId);
    });
  });

  it("extract-flashcards is idempotent: second call skips already-extracted", async () => {
    const note = await app.inject({
      method: "POST",
      url: "/api/v1/notes",
      payload: { title: "X", subject: "bio", body: "{{c1::A::B}}" },
    });
    const noteId = note.json().id;
    const r1 = await app.inject({ method: "POST", url: `/api/v1/notes/${noteId}/extract-flashcards` });
    expect(r1.json().created.length).toBe(1);
    const r2 = await app.inject({ method: "POST", url: `/api/v1/notes/${noteId}/extract-flashcards` });
    expect(r2.json().created.length).toBe(0);
    expect(r2.json().skipped).toBe(1);
  });

  it("DELETE /api/v1/flashcards/:id removes", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/flashcards",
      payload: { front: "to-delete", back: "x" },
    });
    const id = created.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/flashcards/${id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().deleted).toBe(true);
    const get = await app.inject({ method: "GET", url: `/api/v1/flashcards/${id}` });
    expect(get.statusCode).toBe(404);
  });
});
