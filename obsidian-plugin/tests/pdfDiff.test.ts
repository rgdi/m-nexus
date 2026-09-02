import { describe, it, expect } from "vitest";
import { PdfDiff, textSimilarity, extractParagraphs, PdfVersion } from "../src/pdf/diff";

function v(over: Partial<PdfVersion> = {}): PdfVersion {
  return {
    id: over.id ?? "v1",
    filePath: over.filePath ?? "x.pdf",
    uploadedAt: over.uploadedAt ?? "2024-01-01T00:00:00Z",
    size: over.size ?? 1000,
    hash: over.hash ?? "abc",
    text: over.text,
    paragraphs: over.paragraphs,
  };
}

describe("textSimilarity", () => {
  it("idénticas → 1", () => {
    expect(textSimilarity("hola mundo", "hola mundo")).toBe(1);
  });

  it("diferentes → 0", () => {
    expect(textSimilarity("aaaa", "bbbb")).toBe(0);
  });

  it("comparten palabras → entre 0 y 1", () => {
    const s = textSimilarity("el gato come", "el gato duerme");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("vacías → 0", () => {
    expect(textSimilarity("", "x")).toBe(0);
    expect(textSimilarity("x", "")).toBe(0);
  });
});

describe("extractParagraphs", () => {
  it("divide por dobles saltos de línea", () => {
    const text = "Párrafo uno.\n\nPárrafo dos.\n\n\nPárrafo tres.";
    const ps = extractParagraphs(text);
    expect(ps.length).toBe(3);
  });

  it("ignora párrafos muy cortos", () => {
    const ps = extractParagraphs("ok\n\nEste es un párrafo más largo y significativo.");
    expect(ps.length).toBe(1);
  });

  it("normaliza espacios", () => {
    const ps = extractParagraphs("hola    mundo  con   espacios   ");
    expect(ps[0]).not.toContain("  ");
  });
});

describe("PdfDiff.compare", () => {
  const diff = new PdfDiff();

  it("hash igual → sin cambios", () => {
    const a = v({ hash: "x" });
    const b = v({ hash: "x" });
    const r = diff.compare(a, b);
    expect(r.summary.changeRatio).toBe(0);
  });

  it("hash distinto sin texto → diff por metadatos", () => {
    const a = v({ hash: "x", size: 100 });
    const b = v({ hash: "y", size: 200 });
    const r = diff.compare(a, b);
    expect(r.hunks.length).toBeGreaterThan(0);
  });

  it("párrafos idénticos → todos equal", () => {
    const ps = ["Hola mundo", "Adiós mundo", "Tercera línea"];
    const r = diff.compare(v({ paragraphs: ps }), v({ paragraphs: [...ps] }));
    expect(r.summary.equal).toBe(3);
    expect(r.summary.modified).toBe(0);
  });

  it("detecta párrafo añadido en B", () => {
    const a = v({ paragraphs: ["uno", "dos"] });
    const b = v({ paragraphs: ["uno", "dos", "tres"] });
    const r = diff.compare(a, b);
    expect(r.summary.added).toBe(1);
    expect(r.summary.equal).toBe(2);
  });

  it("detecta párrafo eliminado en A", () => {
    const a = v({ paragraphs: ["uno", "dos", "tres"] });
    const b = v({ paragraphs: ["uno", "dos"] });
    const r = diff.compare(a, b);
    expect(r.summary.removed).toBe(1);
  });

  it("detecta párrafo modificado", () => {
    const a = v({ paragraphs: ["El gato come pescado en la cocina"] });
    const b = v({ paragraphs: ["El gato come atún en la cocina"] });
    const r = diff.compare(a, b);
    expect(r.summary.modified + r.summary.equal).toBe(1);
    expect(r.summary.modified).toBe(1);
  });

  it("calcula changeRatio", () => {
    const a = v({ paragraphs: ["uno", "dos", "tres", "cuatro"] });
    const b = v({ paragraphs: ["uno", "dos modificado", "tres", "cuatro", "cinco"] });
    const r = diff.compare(a, b);
    expect(r.summary.changeRatio).toBeGreaterThan(0);
    expect(r.summary.changeRatio).toBeLessThanOrEqual(1);
  });

  it("empty A → todo B es added", () => {
    const a = v({ hash: "a", paragraphs: [] });
    const b = v({ hash: "b", paragraphs: ["contenido nuevo significativo"] });
    const r = diff.compare(a, b);
    expect(r.summary.added).toBe(1);
    expect(r.summary.removed).toBe(0);
  });
});
