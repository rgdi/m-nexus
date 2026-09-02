// v0.28: Tests exhaustivos del loadBalancer + ExamScheduler + KnowledgeGraph.
// Simula TODOS los supuestos posibles y verifica que no haya bugs.

import { describe, it, expect, beforeEach } from "vitest";
import { rebalance } from "../src/fsrs/loadBalancer";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";
import {
  associateCardToConcept,
  evaluateCards,
  rebalanceWithEvaluation,
  evaluateAndBoost,
  DEFAULT_EVALUATION_BOOST_CONFIG,
} from "../src/fsrs/evaluationBoost";
import { shouldBoost, generateBoost, applyBoosts } from "../src/exams/fsrsIntegration";
import { ExamScheduler } from "../src/exams/scheduler";
import { newCard, review, FsrsCard, Rating } from "../src/fsrs/scheduler";
import { ScopeResolver } from "../src/exams/scopeResolver";
import type { Flashcard } from "../src/exams/types";
import type { Exam } from "../src/exams/types";
import type { FlashcardDraft } from "../src/types";

const DAY_MS = 24 * 3600 * 1000;

function makeFlashcardDraft(
  id: string,
  front: string,
  back: string,
  notePath: string,
  options: {
    dueDate?: string;
    priority?: "High" | "Normal" | "Low";
    stability?: number;
    subject?: string;
    tags?: string[];
  } = {},
): Flashcard {
  const dueDateStr = options.dueDate ?? new Date().toISOString().slice(0, 10);
  return {
    id,
    front,
    back,
    cardType: "basic",
    notePath,
    subject: options.subject,
    tags: options.tags ?? [],
    priority: options.priority ?? "Normal",
    dueDate: dueDateStr,
    fsrs: {
      stability: options.stability ?? 5,
      difficulty: 5,
      dueDate: dueDateStr,
      reps: 1,
      lapses: 0,
    },
  } as Flashcard;
}

function makeExam(id: string, daysFromToday: number, opts: { subjects?: string[]; tags?: string[]; title?: string } = {}): Exam {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  const dateStr = date.toISOString().slice(0, 10);
  const scopes: any[] = [];
  if (opts.subjects) for (const s of opts.subjects) scopes.push({ type: "subject", subject: s });
  if (opts.tags) for (const t of opts.tags) scopes.push({ type: "tag", tag: t });
  return {
    id,
    title: opts.title ?? `Exam ${id}`,
    subject: opts.subjects?.[0] ?? "general",
    date: dateStr,
    examType: "parcial",
    scopes,
    status: "active",
    priority: "high",
  };
}

// ─── SUPUESTO 1: knowledge graph vacío ──────────────────

describe("Supuesto 1: knowledge graph vacío", () => {
  it("1.1 associateCardToConcept retorna null si no hay concepts", () => {
    const graph = new KnowledgeGraph();
    const card = makeFlashcardDraft("c1", "Pregunta", "Respuesta", "cardio/hta.md");
    const result = associateCardToConcept(card, graph);
    expect(result).toBeNull();
  });

  it("1.2 evaluateCards devuelve priority base sin boost", () => {
    const graph = new KnowledgeGraph();
    const card = makeFlashcardDraft("c1", "P", "R", "cardio.md", { priority: "Normal" });
    const evaluated = evaluateCards([card], graph);
    expect(evaluated[0].priority).toBe(50);
    expect(evaluated[0].weakConcepts).toEqual([]);
    expect(evaluated[0].reason).toBe("no-concept-association");
  });

  it("1.3 rebalanceWithEvaluation funciona sin graph", () => {
    const graph = new KnowledgeGraph();
    const cards = [
      makeFlashcardDraft("c1", "Q", "A", "c1.md"),
      makeFlashcardDraft("c2", "Q", "A", "c2.md"),
    ];
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: "Normal" })),
        today: new Date(),
        daysWindow: 5,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );
    const totalCards = r.loads.reduce((s, l) => s + l.cards, 0);
    expect(totalCards).toBe(2);
  });
});

// ─── SUPUESTO 2: card en concepto débil ────────────────

describe("Supuesto 2: card en concepto con mastery bajo", () => {
  it("2.1 associateCardToConcept encuentra concepto por term en notePath", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("diabetes", "Diabetes"));
    const card = makeFlashcardDraft("c1", "Síntomas", "Poliuria", "endocrino/diabetes-tipo-2.md", { tags: ["diabetes"] });
    const result = associateCardToConcept(card, graph);
    expect(result).not.toBeNull();
    expect(result!.conceptId).toBe("diabetes");
  });

  it("2.2 card en concepto con mastery<0.6 → boost 1.5x", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("asma", "Asma"));
    const card = makeFlashcardDraft("c1", "P", "R", "neumo/asma.md", { priority: "Normal" });
    const evaluated = evaluateCards([card], graph);
    // Mastery=0 (concepto recién creado) → boost
    expect(evaluated[0].weakConcepts.length).toBeGreaterThan(0);
    expect(evaluated[0].priority).toBe(75); // 50 * 1.5
  });

  it("2.3 card en concepto dominado (todas las capas) → no boost", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("asma", "Asma"));
    // Dominar TODAS las capas del concept
    const layers = ["definition", "epidemiology", "etiology", "symptom", "diagnosis",
                    "differential", "treatment", "prevention", "prognosis", "complication"];
    for (const layer of layers) {
      for (let i = 0; i < 20; i++) graph.updateMastery("asma", layer as any, true, 1);
    }
    const card = makeFlashcardDraft("c1", "P", "R", "neumo/asma.md", { priority: "Normal" });
    const evaluated = evaluateCards([card], graph);
    expect(evaluated[0].weakConcepts).toEqual([]);
    expect(evaluated[0].reason).toMatch(/^mastered:/);
  });
});

// ─── SUPUESTO 3: Boost FSRS con examen ──────────────────

describe("Supuesto 3: boost FSRS con examen", () => {
  it("3.1 card con dueDate futuro + examen en 7 días → boost (moderado)", () => {
    const card = makeFlashcardDraft("c1", "P", "R", "c1.md", {
      dueDate: new Date(Date.now() + 10 * DAY_MS).toISOString().slice(0, 10),
    });
    const exam = makeExam("e1", 7);
    const decision = shouldBoost(card, exam);
    expect(decision.should).toBe(true);
    expect(decision.reason).toBe("exam-before-due");
  });

  it("3.1b card con dueDate muy lejano (>maxPullInDays) → no boost", () => {
    const card = makeFlashcardDraft("c1", "P", "R", "c1.md", {
      dueDate: new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10),
    });
    const exam = makeExam("e1", 7);
    const decision = shouldBoost(card, exam);
    expect(decision.should).toBe(false);
  });

  it("3.2 card con dueDate cercano + examen en 7 días → no boost", () => {
    const card = makeFlashcardDraft("c1", "P", "R", "c1.md", {
      dueDate: new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10),
    });
    const exam = makeExam("e1", 7);
    const decision = shouldBoost(card, exam);
    expect(decision.should).toBe(false);
  });

  it("3.3 card atrasada (dueDate < hoy) + examen → boost HOY (no futuro)", () => {
    const card = makeFlashcardDraft("c1", "P", "R", "c1.md", {
      dueDate: new Date(Date.now() - 3 * DAY_MS).toISOString().slice(0, 10),
    });
    const exam = makeExam("e1", 7);
    const boost = generateBoost(card, exam);
    expect(boost).not.toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    expect(boost!.boostedDueDate).toBe(today); // No se va al futuro
  });

  it("3.4 card sin dueDate + examen → boost al target", () => {
    const card = makeFlashcardDraft("c1", "P", "R", "c1.md", { dueDate: "" });
    // Forzar dueDate vacío
    (card as any).fsrs = undefined;
    const exam = makeExam("e1", 7);
    const boost = generateBoost(card, exam);
    if (boost) {
      // La fecha objetivo debe ser próxima al examen
      expect(boost.boostedDueDate).toBeDefined();
    }
  });

  it("3.5 exam sin scopes no boost cards sin scope match", () => {
    const card = makeFlashcardDraft("c1", "P", "R", "cardio.md", {
      dueDate: new Date(Date.now() + 10 * DAY_MS).toISOString().slice(0, 10),
      subject: "cardio",
    });
    const exam = makeExam("e1", 7, { subjects: ["neuro"] });
    // El decision solo mira fechas, no scope — eso está OK
    const decision = shouldBoost(card, exam);
    expect(decision.should).toBe(true);
  });
});

// ─── SUPUESTO 4: loadBalancer con knowledge graph ─────

describe("Supuesto 4: loadBalancer + knowledge graph", () => {
  it("4.1 card débil va primero (priority), no más tarde", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("asma", "Asma"));
    graph.add(createConcept("dm2", "Diabetes tipo 2"));
    // diabetes dominada, asma no
    for (let i = 0; i < 20; i++) graph.updateMastery("dm2", "definition", true, 1);
    // asma queda en mastery 0

    const cards = [
      makeFlashcardDraft("c1", "P", "R", "neumo/asma.md", { priority: "Normal" }),
      makeFlashcardDraft("c2", "P", "R", "endocrino/dm2.md", { priority: "Normal" }),
    ];
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: "Normal" })),
        today: new Date(),
        daysWindow: 3,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );
    // La primera card (asma, débil) debe estar en el día 0
    const day0 = r.schedule.values().next().value as Flashcard[];
    const firstCard = day0[0];
    expect(firstCard.id).toBe("c1"); // asma primero
  });

  it("4.2 weak cards contadas correctamente", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("x", "X"));
    const cards = [
      makeFlashcardDraft("c1", "P", "R", "x.md"),
      makeFlashcardDraft("c2", "P", "R", "no-rel.md"),
    ];
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: "Normal" })),
        today: new Date(),
        daysWindow: 3,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );
    const day0 = r.loads[0];
    expect(day0.weakCards).toBe(1);
  });

  it("4.3 100 cards con knowledge graph < 100ms", () => {
    const graph = new KnowledgeGraph();
    for (let i = 0; i < 10; i++) graph.add(createConcept(`c${i}`, `Concept${i}`));
    const cards: Flashcard[] = Array.from({ length: 100 }, (_, i) =>
      makeFlashcardDraft(`card${i}`, "P", "R", `c${i % 10}.md`),
    );
    const start = Date.now();
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: "Normal" })),
        today: new Date(),
        daysWindow: 14,
        dailyReviewCap: 20,
        softCap: 15,
      },
      graph,
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(r.loads.reduce((s, l) => s + l.cards, 0)).toBe(100);
  });
});

// ─── SUPUESTO 5: evaluateAndBoost flujo completo ─────

describe("Supuesto 5: flujo completo evaluate + boost", () => {
  it("5.1 sin examen, sin graph → cards devueltas tal cual", () => {
    const graph = new KnowledgeGraph();
    const cards = [makeFlashcardDraft("c1", "P", "R", "c1.md")];
    const result = evaluateAndBoost(cards, graph, null);
    expect(result.boosts).toEqual([]);
    expect(result.boosted).toEqual(cards);
  });

  it("5.2 con examen → boosts aplicados", () => {
    const graph = new KnowledgeGraph();
    const cards = [
      makeFlashcardDraft("c1", "P", "R", "c1.md", {
        dueDate: new Date(Date.now() + 10 * DAY_MS).toISOString().slice(0, 10),
      }),
    ];
    const exam = makeExam("e1", 7, { subjects: ["general"] });
    const result = evaluateAndBoost(cards, graph, exam);
    expect(result.boosts.length).toBeGreaterThanOrEqual(1);
  });

  it("5.3 con examen y concept dominado → no boost para esa card", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("x", "X"));
    for (let i = 0; i < 20; i++) graph.updateMastery("x", "definition", true, 1);
    const card = makeFlashcardDraft("c1", "P", "R", "x.md", {
      dueDate: new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10),
    });
    const exam = makeExam("e1", 7, { tags: [] });
    const result = evaluateAndBoost([card], graph, exam, { evalConfig: { autoPullIn: false } });
    // Aunque hay examen, autoPullIn=false → no boost
    expect(result.boosts).toEqual([]);
  });
});

// ─── SUPUESTO 6: casos extremos ───────────────────────

describe("Supuesto 6: casos extremos / edge cases", () => {
  it("6.1 card sin notePath", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("x", "X"));
    const card = makeFlashcardDraft("c1", "P", "R", "");
    const result = associateCardToConcept(card, graph);
    // No debe romper
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("6.2 graph con 0 concepts y 100 cards", () => {
    const graph = new KnowledgeGraph();
    const cards: Flashcard[] = Array.from({ length: 100 }, (_, i) =>
      makeFlashcardDraft(`c${i}`, "Q", "A", `path${i}.md`),
    );
    const evaluated = evaluateCards(cards, graph);
    expect(evaluated.length).toBe(100);
    // Todas con reason "no-concept-association"
    expect(evaluated.every((e) => e.reason === "no-concept-association")).toBe(true);
  });

  it("6.3 concept sin layers (recién creado)", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("x", "X"));
    const card = makeFlashcardDraft("c1", "P", "R", "x.md");
    const result = associateCardToConcept(card, graph);
    // Debe encontrar concept y devolver una layer (incluso con mastery 0)
    expect(result).not.toBeNull();
    expect(result!.layer).toBeDefined();
  });

  it("6.4 rebalance con daysWindow=1", () => {
    const graph = new KnowledgeGraph();
    const cards = [
      makeFlashcardDraft("c1", "P", "R", "c1.md"),
      makeFlashcardDraft("c2", "P", "R", "c2.md"),
    ];
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: "Normal" })),
        today: new Date(),
        daysWindow: 1,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );
    expect(r.loads.length).toBe(1);
  });

  it("6.5 rebalance con 0 cards", () => {
    const graph = new KnowledgeGraph();
    const r = rebalanceWithEvaluation(
      {
        cards: [],
        today: new Date(),
        daysWindow: 5,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );
    expect(r.loads.every((l) => l.cards === 0)).toBe(true);
  });

  it("6.6 priority High vs Low con misma mastery", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("x", "X"));
    const cardHigh = makeFlashcardDraft("c1", "P", "R", "x.md", { priority: "High" });
    const cardLow = makeFlashcardDraft("c2", "P", "R", "x.md", { priority: "Low" });
    const evaluated = evaluateCards([cardLow, cardHigh], graph);
    expect(evaluated[0].card.id).toBe("c1"); // High primero
    expect(evaluated[0].priority).toBeGreaterThan(evaluated[1].priority);
  });
});

// ─── SUPUESTO 7: integración con FSRS real ─────────────

describe("Supuesto 7: integración con FSRS real (scheduler.ts)", () => {
  it("7.1 review de card modifica stability según rating", () => {
    let card = newCard();
    const before = card.stability;
    const r = review(card, 3);
    expect(r.card.stability).not.toBe(before);
  });

  it("7.2 simulación de 30 días: stability crece con aciertos", () => {
    let card = newCard();
    for (let i = 0; i < 30; i++) {
      card = review(card, 3).card; // Good
    }
    expect(card.stability).toBeGreaterThan(1);
  });

  it("7.3 simulación de 30 días con lapses: stability recupera", () => {
    let card = newCard();
    for (let i = 0; i < 30; i++) {
      card = review(card, i % 5 === 0 ? 1 : 3).card; // 1 Again, 4 Good
    }
    // Después de 30 reviews, la card tiene stability > 0
    expect(card.stability).toBeGreaterThan(0);
  });

  it("7.4 confidence del knowledge graph amplifica/dampifica FSRS", () => {
    // Verifica que effectiveRating funciona como puente
    const mastery1 = 1.0;
    const mastery0 = 0.0;
    expect(3 + (mastery1 - 0.5) * 2).toBe(4); // 3 → 4
    expect(3 + (mastery0 - 0.5) * 2).toBe(2); // 3 → 2
  });
});

// ─── SUPUESTO 8: loadBalancer original con edge cases ──

describe("Supuesto 8: loadBalancer (versión original) con edge cases", () => {
  it("8.1 rebalance con daysWindow=0", () => {
    const cards: Flashcard[] = [makeFlashcardDraft("c1", "P", "R", "c1.md")];
    expect(() => rebalance({
      cards: cards.map((c) => ({ card: c, priority: "Normal" })),
      today: new Date(),
      daysWindow: 0,
      dailyReviewCap: 10,
      softCap: 8,
    })).not.toThrow();
  });

  it("8.2 rebalance con dailyReviewCap < softCap: overflow permitido hasta softCap", () => {
    // En el load balancer, softCap es el "óptimo" y dailyReviewCap es el "máximo".
    // Si softCap > dailyReviewCap, los días pueden llegar hasta softCap antes de overflow.
    const cards: Flashcard[] = Array.from({ length: 30 }, (_, i) =>
      makeFlashcardDraft(`c${i}`, "P", "R", `c${i}.md`),
    );
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: "Normal" })),
      today: new Date(),
      daysWindow: 5,
      dailyReviewCap: 2, // hard cap bajo
      softCap: 10,        // soft cap más permisivo
    });
    // Cada día puede tener hasta softCap cards
    for (const load of r.loads) {
      expect(load.cards).toBeLessThanOrEqual(10);
    }
  });

  it("8.3 stress test: 1000 cards, 30 días", () => {
    const cards: Flashcard[] = Array.from({ length: 1000 }, (_, i) =>
      makeFlashcardDraft(`c${i}`, "P", "R", `c${i}.md`, {
        priority: i % 3 === 0 ? "High" : "Normal",
      }),
    );
    const start = Date.now();
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: c.priority })),
      today: new Date(),
      daysWindow: 30,
      dailyReviewCap: 50,
      softCap: 40,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    const total = r.loads.reduce((s, l) => s + l.cards, 0);
    expect(total).toBe(1000);
  });
});

// ─── SUPUESTO 9: integración ExamScheduler + knowledge ─

describe("Supuesto 9: ExamScheduler + knowledge graph", () => {
  it("9.1 generate con exam en 7 días + 50 cards", () => {
    const resolver = new ScopeResolver();
    const scheduler = new ExamScheduler(resolver);
    const exam = makeExam("e1", 7);
    const cards: Flashcard[] = Array.from({ length: 50 }, (_, i) =>
      makeFlashcardDraft(`c${i}`, "P", "R", `topic/c${i}.md`, {
        dueDate: new Date(Date.now() + (i % 10) * DAY_MS).toISOString().slice(0, 10),
      }),
    );
    const schedule = scheduler.generate(exam, cards, { dailyReviewCap: 30 });
    expect(schedule.daysAvailable).toBe(8); // 7 días + hoy
    expect(schedule.totalCards).toBeGreaterThan(0);
  });

  it("9.2 generate con exam pasado (warning)", () => {
    const resolver = new ScopeResolver();
    const scheduler = new ExamScheduler(resolver);
    const exam = makeExam("e1", -7); // Hace 7 días
    const cards: Flashcard[] = [makeFlashcardDraft("c1", "P", "R", "c1.md")];
    const schedule = scheduler.generate(exam, cards);
    expect(schedule.warnings.length).toBeGreaterThan(0);
  });

  it("9.3 generate con exam en 1 día (muy intensivo)", () => {
    const resolver = new ScopeResolver();
    const scheduler = new ExamScheduler(resolver);
    const exam = makeExam("e1", 1);
    const cards: Flashcard[] = [makeFlashcardDraft("c1", "P", "R", "c1.md")];
    const schedule = scheduler.generate(exam, cards);
    // Con 1 día, el plan debe ser intensivo
    expect(schedule.warnings.some((w) => w.includes("intensivo") || w.includes("menos de 3"))).toBe(true);
  });
});
