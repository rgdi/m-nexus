// Tests para SearchService (Fase 2.A) - full-text search con FTS5.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SearchService, type SearchResult } from "../src/services/searchService";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("SearchService", () => {
  let service: SearchService;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mnexus-search-"));
    const dbPath = path.join(tmpDir, "test-search.db");
    service = new SearchService(dbPath);
  });

  afterAll(() => {
    service.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initializes with FTS5 if available", () => {
    const stats = service.stats();
    expect(stats.total).toBe(0);
    expect(typeof stats.fts5).toBe("boolean");
  });

  it("indexes a single note", () => {
    service.indexNote({
      path: "Anatomia/diafragma.md",
      title: "Diafragma",
      content: "El diafragma es un músculo en forma de cúpula que separa las cavidades torácica y abdominal.",
      tags: ["anatomia", "respiratorio"],
      modified: Date.now(),
    });
    expect(service.count()).toBe(1);
  });

  it("searches with single word and finds the note", () => {
    const results = service.search("diafragma");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("Anatomia/diafragma.md");
    expect(results[0].title).toBe("Diafragma");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("indexes multiple notes in batch", () => {
    service.indexNotes([
      {
        path: "Fisio/ciclo_krebs.md",
        title: "Ciclo de Krebs",
        content: "El ciclo de Krebs ocurre en la matriz mitocondrial y produce ATP.",
        tags: ["fisiologia", "bioquimica"],
        modified: Date.now(),
      },
      {
        path: "Fisio/glucolisis.md",
        title: "Glucólisis",
        content: "La glucólisis es el proceso de degradación de la glucosa en el citoplasma.",
        tags: ["fisiologia", "bioquimica"],
        modified: Date.now(),
      },
    ]);
    expect(service.count()).toBe(3);
  });

  it("searches multi-word and ranks by relevance", () => {
    const results = service.search("ciclo Krebs");
    expect(results.length).toBeGreaterThan(0);
    // El Ciclo de Krebs debe estar primero (más relevante)
    expect(results[0].path).toContain("ciclo_krebs");
  });

  it("filters by tags (AND)", () => {
    const results = service.search("músculo", { tags: ["anatomia"] });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.tags).toContain("anatomia");
    }
  });

  it("returns empty for no matches", () => {
    const results = service.search("xyzzy_no_existe_123");
    expect(results.length).toBe(0);
  });

  it("handles special characters gracefully", () => {
    // Query con caracteres especiales no debe crashear
    const results = service.search('"músculo" AND diafragma');
    // No error, puede o no tener resultados
    expect(Array.isArray(results)).toBe(true);
  });

  it("removes note from index", () => {
    service.removeNote("Anatomia/diafragma.md");
    const results = service.search("diafragma");
    expect(results.find((r) => r.path === "Anatomia/diafragma.md")).toBeUndefined();
  });

  it("updates note on re-index (INSERT OR REPLACE)", () => {
    service.indexNote({
      path: "Fisio/test.md",
      title: "Test Original",
      content: "contenido original",
      tags: [],
      modified: 1000,
    });
    expect(service.count()).toBeGreaterThan(0);
    service.indexNote({
      path: "Fisio/test.md",
      title: "Test Updated",
      content: "contenido actualizado con keyword_unica_xyz",
      tags: [],
      modified: 2000,
    });
    const results = service.search("keyword_unica_xyz");
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Test Updated");
  });

  it("generates snippet with context", () => {
    service.indexNote({
      path: "test/snippet.md",
      title: "Snippet Test",
      content: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.",
      tags: [],
      modified: Date.now(),
    });
    const results = service.search("consectetur");
    expect(results.length).toBe(1);
    expect(results[0].snippet).toContain("consectetur");
    expect(results[0].snippet.length).toBeLessThan(300); // snippet recortado
  });

  it("respects limit option", () => {
    // Index 20 notas
    for (let i = 0; i < 20; i++) {
      service.indexNote({
        path: `bulk/note${i}.md`,
        title: `Note ${i}`,
        content: `bulk content with keyword ${i}`,
        tags: [],
        modified: Date.now() + i,
      });
    }
    const results = service.search("bulk", { limit: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("clear() removes all notes", () => {
    service.clear();
    expect(service.count()).toBe(0);
  });
});
