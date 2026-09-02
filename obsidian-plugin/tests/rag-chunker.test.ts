import { describe, it, expect } from "vitest";
import { chunkNote, hashText } from "../src/rag/chunker";
import { cosine } from "../src/rag/vectorStore";

describe("RAG chunker", () => {
  const sample = `---
title: "Cardiología"
subject: "Cardio"
---
# Valvulopatía Aórtica

## Etiología
Causa degenerativa (mayores 65) y bicúspide (1-2%).

## Clínica
Disnea, angina, síncope. Supervivencia media 2-3 años.

## Diagnóstico
Gold standard: ecocardiografía. Área < 1 cm² = grave.
`;

  it("respeta headers como boundaries", () => {
    const chunks = chunkNote({ basename: "Valvulo", path: "x.md" }, sample);
    const sections = chunks.map((c) => c.section).filter(Boolean);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections).toContain("Etiología");
    expect(sections).toContain("Clínica");
  });

  it("strip el frontmatter", () => {
    const chunks = chunkNote({ basename: "Valvulo", path: "x.md" }, sample);
    for (const c of chunks) {
      expect(c.text).not.toContain("title:");
      expect(c.text).not.toContain("subject:");
    }
  });

  it("ignora chunks demasiado cortos", () => {
    const short = `# Título
muy corto`;
    const chunks = chunkNote({ basename: "X", path: "x.md" }, short, { minLength: 50 });
    // Solo el título es < minLength, así que no debería haber chunks con cuerpo
    const withBody = chunks.filter((c) => c.text.length > 30);
    expect(withBody.length).toBe(0);
  });

  it("subdivide secciones largas", () => {
    const longSection = "## Larga\n" + "Lorem ipsum dolor sit amet. ".repeat(50);
    const chunks = chunkNote({ basename: "X", path: "x.md" }, longSection, { targetSize: 200, overlap: 30 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("hashText es determinista", () => {
    expect(hashText("hola")).toBe(hashText("hola"));
  });

  it("hashText distingue contenido distinto", () => {
    expect(hashText("hola")).not.toBe(hashText("adios"));
  });
});

describe("Cosine similarity", () => {
  it("idénticos → 1", () => {
    const v = [1, 2, 3];
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("ortogonales → 0", () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it("opuestos → -1", () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it("vectores de distinta dimensión → 0", () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });

  it("vector cero → 0", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});
