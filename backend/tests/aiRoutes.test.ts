// v0.28: Tests de las rutas AI del backend (vault eval, proposals, knowledge, quiz, fsrs).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("AI Routes — vault eval", () => {
  it("evalúa un vault pequeño", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/vault/eval",
      payload: {
        snapshots: [
          {
            path: "anatomia/membrana.md",
            basename: "membrana",
            content: "La membrana celular es una bicapa lipídica. " + "x".repeat(200),
            size: 250,
            wordCount: 50,
            tags: ["anatomia"],
            links: [],
            hasAudio: false,
            hasPdf: false,
            hasFlashcards: false,
            topic: "anatomia",
          },
          {
            path: "bioquimica/krebs.md",
            basename: "krebs",
            content: "El ciclo de Krebs genera NADH. " + "x".repeat(200),
            size: 250,
            wordCount: 50,
            tags: [],
            links: [],
            hasAudio: false,
            hasPdf: false,
            hasFlashcards: false,
            topic: "bioquimica",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalNotes).toBe(2);
    expect(body.untagged.length).toBe(1);
    expect(body.subjects.length).toBe(2);
  });

  it("detecta notesWithoutFlashcards", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/vault/eval",
      payload: {
        snapshots: [
          { path: "a.md", basename: "a", content: "x ".repeat(100), size: 200, wordCount: 100, tags: ["t"], links: [], hasAudio: false, hasPdf: false, hasFlashcards: false, topic: "t" },
        ],
      },
    });
    const body = res.json();
    expect(body.notesWithoutFlashcards.length).toBe(1);
  });
});

describe("AI Routes — proposals", () => {
  it("genera proposals de flashcards para notas sin cards", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/proposals/generate",
      payload: {
        evaluation: {
          totalNotes: 1, totalWords: 100, totalFlashcards: 0, totalAudio: 0, totalPdf: 0,
          averageQuality: 0, untagged: [], orphaned: [], shortNotes: [],
          notesWithoutFlashcards: [
            { path: "anatomia/membrana.md", basename: "membrana", content: "## Componentes\n- Fosfolípidos\n- Proteínas\n- Glucocálix", size: 200, wordCount: 60, tags: ["anatomia"], links: [], hasAudio: false, hasPdf: false, hasFlashcards: false, topic: "anatomia" },
          ],
          topics: [{ name: "anatomia", count: 1, notes: ["anatomia/membrana.md"] }],
          subjects: [{ name: "anatomia", noteCount: 1, wordCount: 60, flashcards: 0 }],
          gaps: [],
        },
        snapshots: [
          { path: "anatomia/membrana.md", basename: "membrana", content: "## Componentes\n- Fosfolípidos\n- Proteínas\n- Glucocálix", size: 200, wordCount: 60, tags: ["anatomia"], links: [], hasAudio: false, hasPdf: false, hasFlashcards: false, topic: "anatomia" },
        ],
        config: { autoGenerateTypes: ["flashcards"], minScore: 0.3, maxPendingProposals: 5 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.proposals.length).toBeGreaterThan(0);
    expect(body.proposals[0].type).toBe("flashcards");
    expect(body.proposals[0].cards.length).toBeGreaterThan(0);
  });
});

describe("AI Routes — knowledge graph", () => {
  it("crea y recupera concepts", async () => {
    const userId = "test-user-1";
    // Crear
    let res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/knowledge/${userId}/concept`,
      payload: { id: "diabetes", term: "Diabetes tipo 2" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Listar
    res = await app.inject({ method: "GET", url: `/api/v1/ai/knowledge/${userId}` });
    const body = res.json();
    expect(body.concepts.length).toBe(1);
    expect(body.concepts[0].term).toBe("Diabetes tipo 2");
  });

  it("actualiza mastery", async () => {
    const userId = "test-user-2";
    await app.inject({
      method: "POST",
      url: `/api/v1/ai/knowledge/${userId}/concept`,
      payload: { id: "asma", term: "Asma" },
    });
    let res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/knowledge/${userId}/mastery`,
      payload: { conceptId: "asma", layer: "definition", correct: true, confidence: 1 },
    });
    expect(res.statusCode).toBe(200);

    // Verificar mastery subió
    res = await app.inject({ method: "GET", url: `/api/v1/ai/knowledge/${userId}` });
    const concept = res.json().concepts[0];
    expect(concept.layers.definition.mastery).toBeGreaterThan(0);
  });

  it("encuentra gaps", async () => {
    const userId = "test-user-3";
    await app.inject({
      method: "POST",
      url: `/api/v1/ai/knowledge/${userId}/concept`,
      payload: { id: "hta", term: "Hipertensión" },
    });
    const res = await app.inject({ method: "GET", url: `/api/v1/ai/knowledge/${userId}/gaps` });
    const body = res.json();
    expect(body.gaps.length).toBeGreaterThan(0);
  });
});

describe("AI Routes — quiz adaptativo", () => {
  it("crea sesión y devuelve preguntas", async () => {
    const userId = "test-quiz-1";
    await app.inject({
      method: "POST",
      url: `/api/v1/ai/knowledge/${userId}/concept`,
      payload: { id: "cancer", term: "Cáncer de pulmón" },
    });

    let res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/quiz/${userId}/session`,
      payload: { config: { maxQuestions: 3, mode: "diagnostic" } },
    });
    expect(res.statusCode).toBe(200);
    const session = res.json();
    expect(session.id).toBeDefined();

    res = await app.inject({ method: "GET", url: `/api/v1/ai/quiz/${userId}/next` });
    const body = res.json();
    expect(body.question).not.toBeNull();
    expect(body.question.conceptId).toBe("cancer");
  });

  it("responde pregunta y actualiza mastery", async () => {
    const userId = "test-quiz-2";
    await app.inject({
      method: "POST",
      url: `/api/v1/ai/knowledge/${userId}/concept`,
      payload: { id: "migrana", term: "Migraña" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/ai/quiz/${userId}/session`,
      payload: { config: { maxQuestions: 2 } },
    });
    await app.inject({ method: "GET", url: `/api/v1/ai/quiz/${userId}/next` });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/ai/quiz/${userId}/answer`,
      payload: { answer: "Migraña", confidence: 1, timeMs: 1000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.correct).toBe(true);
  });
});

describe("AI Routes — cross-relevance", () => {
  it("encuentra notas similares", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/cross-relevance/analyze",
      payload: {
        source: { path: "a.md", content: "Diabetes mellitus tipo 2 tratamiento con metformina y dieta" },
        candidates: [
          { path: "b.md", content: "Diabetes tipo 2 manejo con metformina y cambios estilo vida" },
          { path: "c.md", content: "Hipertensión arterial tratamiento con enalapril" },
        ],
        minSimilarity: 0.2,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matches.length).toBeGreaterThan(0);
    // b.md debe estar primero (más similar a a.md)
    expect(body.matches[0].path).toBe("b.md");
    if (body.matches.length > 1) {
      expect(body.matches[0].similarity).toBeGreaterThan(body.matches[1].similarity);
    }
  });
});

describe("AI Routes — FSRS review", () => {
  it("review con rating 3 (Good) da interval positivo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/fsrs/review",
      payload: {
        card: { stability: 1, difficulty: 5, reps: 0, lapses: 0 },
        rating: 3,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intervalDays).toBeGreaterThan(0);
    expect(body.card.stability).toBeGreaterThan(0);
    expect(body.card.reps).toBe(1);
  });

  it("review con rating 1 (Again) incrementa lapses", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/ai/fsrs/review",
      payload: {
        card: { stability: 5, difficulty: 5, reps: 1, lapses: 0 },
        rating: 1,
      },
    });
    const body = res.json();
    expect(body.card.lapses).toBe(1);
  });
});
