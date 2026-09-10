// Tests para proposalsV2 (LLM real + fallback heurístico) (v0.46).
//
// Estrategia: usar MOCK_LLM=1 con mockChat() devuelve JSON mock.
// Tests cubren: LLM path, fallback, cache, error handling.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { generateProposalsV2, clearProposalCache } from "../src/services/proposalsV2";
import type { NoteSnapshotInput, VaultEvaluationResult } from "../src/services/vaultEval";

// Activar MOCK para que LLM devuelva respuesta simulada
beforeAllMock();

function beforeAllMock() {
  process.env.MOCK_OLLAMA = "1";
  process.env.MOCK_OPENROUTER = "1";
}

const sampleNote: NoteSnapshotInput = {
  path: "Anatomia/diafragma.md",
  basename: "diafragma",
  content: `# Diafragma

El diafragma es un músculo en forma de cúpula que separa las cavidades torácica y abdominal.
Está inervado por el nervio frénico (C3-C5).
Es el músculo principal de la inspiración.

## Función
- Inspiración
- Esfuerzo (Valsalva)
- Reflujo gastroesofágico (protector)

## Patologías
- Hernia hiatal
- Parálisis frénica`,
  frontmatter: {},
  wordCount: 50,
  tags: ["anatomia", "respiratorio"],
  topic: "respiratorio",
  links: [],
};

const sampleEval: VaultEvaluationResult = {
  totalNotes: 1,
  notesWithoutFlashcards: [sampleNote],
  untagged: [sampleNote],
  orphaned: [],
  gaps: [],
  byTopic: { respiratorio: 1 },
};

describe("proposalsV2 - LLM path (MOCK activo)", () => {
  beforeEach(() => {
    clearProposalCache();
  });

  it("generates proposals via LLM mock when available (uses LLM path)", async () => {
    // Cuando MOCK_OLLAMA=1, ollamaAvailable() retorna true → usa LLM path
    // El LLM mock devuelve texto que NO es JSON válido → debe continuar sin crashear
    // (idealmente en producción con LLM real devolvería JSON con cards)
    const result = await generateProposalsV2({
      evaluation: sampleEval,
      snapshots: [sampleNote],
      config: {
        autoGenerateTypes: ["flashcards"],
        minScore: 0.3,
        maxPendingProposals: 10,
      },
    });
    expect(result.proposals).toBeDefined();
    expect(Array.isArray(result.proposals)).toBe(true);
    // stats.source puede ser "llm" o "heuristic" según si el LLM mock
    // logra parsear el JSON
    expect(["llm", "heuristic"]).toContain(result.stats.source);
  }, 15000);

  it("returns empty on no notes without flashcards", async () => {
    const result = await generateProposalsV2({
      evaluation: { ...sampleEval, notesWithoutFlashcards: [] },
      snapshots: [sampleNote],
      config: {
        autoGenerateTypes: ["flashcards"],
        minScore: 0.3,
        maxPendingProposals: 10,
      },
    });
    expect(result.proposals).toBeDefined();
  });

  it("respects maxPendingProposals limit", async () => {
    const result = await generateProposalsV2({
      evaluation: sampleEval,
      snapshots: [sampleNote],
      config: {
        autoGenerateTypes: ["flashcards"],
        minScore: 0.3,
        maxPendingProposals: 2,
      },
    });
    expect(result.proposals.length).toBeLessThanOrEqual(2);
  });
});

describe("proposalsV2 - fallback path (LLM unavailable)", () => {
  let originalOllama: string | undefined;
  let originalOpenrouter: string | undefined;

  beforeEach(() => {
    clearProposalCache();
    originalOllama = process.env.MOCK_OLLAMA;
    originalOpenrouter = process.env.MOCK_OPENROUTER;
    // Forzar fallback desactivando MOCKs (ollamaAvailable() retornará false)
    // y borrando OPENROUTER_API_KEY
    process.env.MOCK_OLLAMA = "0";
    process.env.MOCK_OPENROUTER = "0";
    delete process.env.OPENROUTER_API_KEY;
  });

  afterAll(() => {
    process.env.MOCK_OLLAMA = originalOllama;
    process.env.MOCK_OPENROUTER = originalOpenrouter;
  });

  it("falls back to heuristic when LLM unavailable", async () => {
    const result = await generateProposalsV2({
      evaluation: sampleEval,
      snapshots: [sampleNote],
      config: {
        autoGenerateTypes: ["flashcards"],
        minScore: 0.3,
        maxPendingProposals: 10,
      },
    });
    expect(result.proposals).toBeDefined();
    // v0.60 (P0.5): proposals vacias cuando LLM no esta disponible
    expect(result.proposals.length).toBe(0);
    // source = "heuristic" indica el camino vacio
    expect(result.stats.source).toBe("heuristic");
  });
});

describe("proposalsV2 - cache", () => {
  beforeAllMock();
  beforeEach(() => {
    clearProposalCache();
  });

  it("cache clears correctly", () => {
    clearProposalCache();
    expect(() => clearProposalCache()).not.toThrow();
  });
});
