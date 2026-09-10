// pdfAnnotation.test.ts: tests de highlights PDF (v0.60 P2.1)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { getPdfAnnotationService } from "../src/services/pdfAnnotationService.js";

describe("PdfAnnotationService (P2.1)", () => {
  it("agrega highlight", () => {
    const svc = getPdfAnnotationService();
    const before = svc.list("doc1.pdf").length;
    const h = svc.add({
      documentPath: "doc1.pdf", page: 1, format: "text",
      text: "Lorem ipsum", color: "#FFFF00",
    });
    expect(h.id).toBeDefined();
    expect(svc.list("doc1.pdf").length).toBe(before + 1);
  });
  it("actualiza highlight", () => {
    const svc = getPdfAnnotationService();
    const h = svc.add({
      documentPath: "doc2.pdf", page: 2, format: "rect", text: "Area 1", color: "#FF0000",
    });
    const u = svc.update(h.id, "doc2.pdf", { color: "#00FF00", text: "Area 1 mod" });
    expect(u?.color).toBe("#00FF00");
    expect(u?.text).toBe("Area 1 mod");
  });
  it("elimina highlight", () => {
    const svc = getPdfAnnotationService();
    const h = svc.add({
      documentPath: "doc3.pdf", page: 1, format: "text", text: "t", color: "#FFF",
    });
    const ok = svc.remove(h.id, "doc3.pdf");
    expect(ok).toBe(true);
  });
  it("exporta a markdown", () => {
    const svc = getPdfAnnotationService();
    svc.add({ documentPath: "doc4.pdf", page: 1, format: "text", text: "alpha", color: "#FFF" });
    svc.add({ documentPath: "doc4.pdf", page: 1, format: "text", text: "beta", color: "#FFF" });
    svc.add({ documentPath: "doc4.pdf", page: 2, format: "rect", text: "gamma", color: "#FFF" });
    const md = svc.exportAsMarkdown("doc4.pdf");
    expect(md).toContain("# Highlights: doc4.pdf");
    expect(md).toContain("## Pagina 1");
    expect(md).toContain("> alpha");
    expect(md).toContain("> beta");
    expect(md).toContain("## Pagina 2");
    expect(md).toContain("> gamma");
  });
  it("devuelve empty list para doc sin highlights", () => {
    const svc = getPdfAnnotationService();
    expect(svc.list("doc-no-existe.pdf").length).toBe(0);
  });
});

describe("PdfAnnotation HTTP routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const { pdfAnnotationRoutes } = await import("../src/routes/pdfAnnotation.js");
    await app.register(pdfAnnotationRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

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
  it("GET export markdown", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/pdf/highlights/export?documentPath=test.pdf" });
    expect(r.statusCode).toBe(200);
    expect(r.json().markdown).toContain("Highlights: test.pdf");
  });
  it("DELETE highlight", async () => {
    // crear
    const r1 = await app.inject({
      method: "POST", url: "/api/v1/pdf/highlights",
      payload: { documentPath: "del.pdf", page: 1, format: "text", text: "x" },
    });
    const id = r1.json().id;
    // borrar
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
});
