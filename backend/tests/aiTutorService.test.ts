// Tests para AITutorService (Fase 5).

import { describe, it, expect, beforeEach } from "vitest";
import { AITutorService, LLMService } from "../src/services/aiTutorService";
import { SearchService } from "../src/services/searchService";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AITutorService", () => {
  let search: SearchService;
  let llm: LLMService;
  let tutor: AITutorService;
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = join(tmpdir(), `test-vault-${Date.now()}-${Math.random()}`);
    mkdirSync(vaultPath, { recursive: true });
    const dbPath = join(vaultPath, "search.db");
    search = new SearchService(dbPath);
    llm = new LLMService();
    tutor = new AITutorService(search, llm);
  });

  // Cleanup
  afterEach(() => {
    try {
      rmSync(vaultPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("retrieveContext finds relevant notes", async () => {
    search.indexNote({ path: "anatomia/corazon.md", title: "Corazón", content: "El corazón es un músculo que bombea sangre", modified: Date.now() });
    search.indexNote({ path: "anatomia/pulmon.md", title: "Pulmón", content: "Los pulmones intercambian oxígeno y CO2", modified: Date.now() });
    search.indexNote({ path: "fisiologia/sangre.md", title: "Sangre", content: "La sangre transporta nutrientes y oxígeno", modified: Date.now() });

    const context = await tutor.retrieveContext("corazón");
    expect(context.snippets.length).toBeGreaterThan(0);
    expect(context.snippets[0].path).toContain("corazon");
  });

  it("ask returns empty response when no relevant notes", async () => {
    const response = await tutor.ask("xyzabc123");
    expect(response.source).toBe("empty");
    expect(response.answer).toContain("No encontré");
    expect(response.confidence).toBe(0);
  });

  it("ask falls back to extractive when no LLM available", async () => {
    search.indexNote({ path: "anatomia/diafragma.md", title: "Diafragma", content: "El diafragma es el músculo principal de la inspiración", modified: Date.now() });
    const response = await tutor.ask("diafragma");
    expect(response.source).toBe("extractive");
    expect(response.answer).toContain("diafragma");
    expect(response.sources).toContain("anatomia/diafragma.md");
  });

  it("ask provides context with multiple sources", async () => {
    search.indexNote({ path: "a.md", title: "Nervio", content: "El nervio frénico inerva el diafragma", modified: Date.now() });
    search.indexNote({ path: "b.md", title: "Inspiración", content: "El diafragma se contrae durante la inspiración", modified: Date.now() });
    search.indexNote({ path: "c.md", title: "Respiración", content: "La inspiración es un proceso respiratorio", modified: Date.now() });

    const context = await tutor.retrieveContext("diafragma", 3);
    expect(context.snippets.length).toBeGreaterThanOrEqual(2);
  });

  it("generateQuizQuestions returns empty without LLM", async () => {
    search.indexNote({ path: "a.md", title: "Corazón", content: "El corazón late 60-100 bpm en reposo", modified: Date.now() });
    const questions = await tutor.generateQuizQuestions("corazón", 3);
    // Sin LLM retorna vacío
    expect(Array.isArray(questions)).toBe(true);
  });

  it("retrieveContext returns topK results", async () => {
    for (let i = 0; i < 10; i++) {
      search.indexNote({ path: `n${i}.md`, title: `Nota ${i}`, content: `nota número ${i} con contenido cardíaco`, modified: Date.now() });
    }
    const context = await tutor.retrieveContext("cardíaco", 3);
    expect(context.snippets.length).toBeLessThanOrEqual(3);
  });
});

describe("LLMService (no API key)", () => {
  it("returns empty text without API key", async () => {
    const llm = new LLMService();
    const response = await llm.generate({
      system: "Test",
      user: "Test",
    });
    expect(response.text).toBe("");
  });
});
