// pdfAnnotation.test.ts: tests de highlights PDF.
//
// v2.28.0 — refactored to use the new persisted pdfAnnotationStorage
// instead of the removed in-memory service.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { pdfAnnotationStorage } from "../src/services/pdfAnnotationStorage.js";

const HIGHLIGHTS_FILE = join(process.cwd(), "data", "pdf-highlights.json");

describe("PdfAnnotationStorage (v2.28 — persisted)", () => {
  beforeEach(async () => {
    try { await fs.unlink(HIGHLIGHTS_FILE); } catch {}
    await pdfAnnotationStorage._reset();
  });

  it("agrega highlight", async () => {
    const before = (await pdfAnnotationStorage.list("doc1.pdf")).length;
    const h = await pdfAnnotationStorage.add({
      id: "hl-x", documentPath: "doc1.pdf", page: 1, format: "text",
      text: "Lorem ipsum", color: "#FFFF00",
    });
    expect(h.id).toBe("hl-x");
    expect((await pdfAnnotationStorage.list("doc1.pdf")).length).toBe(before + 1);
  });

  it("actualiza highlight", async () => {
    const h = await pdfAnnotationStorage.add({
      id: "hl-y", documentPath: "doc2.pdf", page: 2, format: "rect", text: "Area 1", color: "#FF0000",
    });
    const u = await pdfAnnotationStorage.update("hl-y", "doc2.pdf", { color: "#00FF00", text: "Area 1 mod" });
    expect(u?.color).toBe("#00FF00");
    expect(u?.text).toBe("Area 1 mod");
  });

  it("elimina highlight", async () => {
    await pdfAnnotationStorage.add({
      id: "hl-z", documentPath: "doc3.pdf", page: 1, format: "text", text: "t", color: "#FFF",
    });
    const ok = await pdfAnnotationStorage.remove("hl-z", "doc3.pdf");
    expect(ok).toBe(true);
  });

  it("devuelve empty list para doc sin highlights", async () => {
    expect((await pdfAnnotationStorage.list("doc-no-existe.pdf")).length).toBe(0);
  });
});

describe("PdfAnnotation HTTP routes (v2.28)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    try { await fs.unlink(HIGHLIGHTS_FILE); } catch {}
    app = Fastify();
    const { pdfAnnotationRoutes } = await import("../src/routes/pdfAnnotation.js");
    await app.register(pdfAnnotationRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    try { await fs.unlink(HIGHLIGHTS_FILE); } catch {}
  });

  it("POST + GET highlights", async () => {
    const r1 = await app.inject({
      method: "POST", url: "/api/v1/pdf/highlights",
      payload: { documentPath: "test.pdf", page: 1, format: "text", text: "hola" },
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.inject({ method: "GET", url: "/api/v1/pdf/highlights?documentPath=test.pdf" });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().highlights.length).toBeGreaterThan(0);
  });

  it("POST invalid format -> 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/pdf/highlights",
      payload: { documentPath: "x.pdf", page: 1, format: "wrong", text: "x" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("DELETE highlight", async () => {
    const r1 = await app.inject({
      method: "POST", url: "/api/v1/pdf/highlights",
      payload: { documentPath: "del.pdf", page: 1, format: "text", text: "x" },
    });
    const id = r1.json().id;
    const r2 = await app.inject({
      method: "DELETE", url: `/api/v1/pdf/highlights/${id}?documentPath=del.pdf`,
    });
    expect(r2.statusCode).toBe(200);
  });

  it("DELETE no existente -> 404", async () => {
    const r = await app.inject({
      method: "DELETE", url: "/api/v1/pdf/highlights/nonexistent?documentPath=del.pdf",
    });
    expect(r.statusCode).toBe(404);
  });

  it("POST highlight + POST card from highlight", async () => {
    const r1 = await app.inject({
      method: "POST", url: "/api/v1/pdf/highlights",
      payload: {
        documentPath: "combined.pdf",
        page: 1,
        format: "text",
        text: "insulina",
        contextBefore: "El pancreas segrega",
        contextAfter: " y la libera",
        subject: "bio",
      },
    });
    expect(r1.statusCode).toBe(201);
    const id = r1.json().id;
    const r2 = await app.inject({
      method: "POST", url: `/api/v1/pdf/highlights/${id}/cards`,
      payload: { preferType: "cloze" },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().cardType).toBe("cloze");
    expect(r2.json().persisted).toBe(true);
  });
});
