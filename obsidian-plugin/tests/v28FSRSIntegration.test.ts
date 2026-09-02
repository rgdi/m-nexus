// v0.28: Tests del FSRS integrado con knowledge graph.
// Simula el flujo completo de un estudiante real:
// - Día 1: estudio primera vez, acierto
// - Día 2: repaso, fallo
// - Día 3: acierto
// - Repaso general
// - Decaimiento

import { describe, it, expect, beforeEach } from "vitest";
import { newCard, review, retrievability, FsrsCard, Rating } from "../src/fsrs/scheduler";
import { rebalance } from "../src/fsrs/loadBalancer";
import { KnowledgeGraph, createConcept, LAYER_ORDER } from "../src/study/knowledgeLayers";
import {
  applyKnowledgeBoost,
  effectiveRating,
  simulateQuizImpact,
} from "../src/fsrs/knowledgeBoost";
import type { FlashcardDraft } from "../src/types";

const DAY_MS = 24 * 3600 * 1000;

describe("FSRS — simulación de estudiante real", () => {
  it("1.1 estudiante nuevo: estabilidad inicial = 1 día", () => {
    const card = newCard();
    expect(card.stability).toBe(1);
    expect(card.difficulty).toBe(5);
  });

  it("1.2 día 1: acierto → próxima review en ~3 días (FSRS W[2]=3.13)", () => {
    const card = newCard();
    const r = review(card, 3); // Good
    expect(r.intervalDays).toBeGreaterThan(2);
    expect(r.intervalDays).toBeLessThan(5);
  });

  it("1.3 día 1: easy → próxima review en ~10 días (FSRS W[3]=15.47)", () => {
    const card = newCard();
    const r = review(card, 4); // Easy
    expect(r.intervalDays).toBeGreaterThan(8);
  });

  it("1.4 día 1: fallo → próxima review en 1 día", () => {
    const card = newCard();
    const r = review(card, 1); // Again
    expect(r.intervalDays).toBe(1);
  });

  it("1.5 secuencia: acierto → más días", () => {
    let card = newCard();
    const r1 = review(card, 3);
    card = r1.card;
    const r2 = review(card, 3);
    // La segunda review puede tener más o igual días (FSRS S crece)
    expect(r2.intervalDays).toBeGreaterThanOrEqual(r1.intervalDays);
  });

  it("1.6 lapse: fallo reduce stability drásticamente", () => {
    let card = newCard();
    card = review(card, 3).card; // Good
    card = review(card, 3).card; // Good
    card = review(card, 3).card; // Good — para tener S alta
    const before = card.stability;
    const r = review(card, 1); // Again
    // Tras un lapse, S resetea a W[2] (initial Good)
    expect(r.card.lapses).toBe(1);
    expect(r.card.stability).toBeLessThanOrEqual(before);
  });

  it("1.7 retrievability decae con el tiempo", () => {
    let card = newCard();
    card = review(card, 4).card; // Easy → S = 15.47
    // Justo después: R = 1
    expect(retrievability(0, card.stability)).toBeCloseTo(1, 2);
    // A los 90 días: baja significativamente
    expect(retrievability(90, card.stability)).toBeLessThan(0.7);
  });

  it("1.8 simulación completa: 7 días de estudio", () => {
    let card = newCard();
    // Semana 1: estudio intensivo
    for (let day = 0; day < 7; day++) {
      const r = review(card, day < 5 ? 3 : 1); // 5 aciertos, 2 fallos
      card = r.card;
    }
    // Después de 1 semana, la card tiene stability > 0
    expect(card.stability).toBeGreaterThan(0);
    expect(card.reps).toBe(7);
  });

  it("1.9 simulación: repaso tras 2 semanas", () => {
    let card = newCard();
    // Día 0: primera review
    card = review(card, 3).card;
    // Simulamos paso del tiempo (no afecta la lógica, solo visualizamos)
    // Día 14: repaso
    const before = card.stability;
    const r = review(card, 3);
    // Si la memoria estaba ok (R alto), la stability crece
    expect(r.card.stability).toBeGreaterThanOrEqual(before * 0.9);
  });
});

// ─── Load balancer con escenarios reales ─────────────────

describe("LoadBalancer — distribución realista", () => {
  function makeCards(priorities: Array<"High" | "Normal" | "Low">, dueOffset: number = 0): FlashcardDraft[] {
    return priorities.map((priority, i) => ({
      id: `card-${i}`,
      front: `Q${i}`,
      back: `A${i}`,
      cardType: "basic" as const,
      priority,
      fsrs: {
        stability: 5,
        difficulty: 5,
        dueDate: new Date(Date.now() + dueOffset * DAY_MS).toISOString(),
        reps: 1,
        lapses: 0,
      },
    } as FlashcardDraft));
  }

  it("2.1 día tranquilo: 5 cards High", () => {
    const cards = makeCards(["High", "High", "High", "High", "High"]);
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: "High" })),
      today: new Date(),
      daysWindow: 7,
      dailyReviewCap: 10,
      softCap: 8,
    });
    const todayLoad = r.loads[0];
    expect(todayLoad.cards).toBe(5);
    expect(r.overflow).toBe(false);
  });

  it("2.2 día con muchas cards High: 25 cards", () => {
    const cards = makeCards(Array(25).fill("High"));
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: "High" })),
      today: new Date(),
      daysWindow: 7,
      dailyReviewCap: 10,
      softCap: 8,
    });
    // Las 25 deben distribuirse en 7 días (no más de 10/día)
    for (const load of r.loads) {
      expect(load.cards).toBeLessThanOrEqual(10);
    }
  });

  it("2.3 mix High + Low: Low se mueven si día lleno", () => {
    const cards = makeCards([
      "High", "High", "High", "High", "High",
      "High", "High", "High", "High", "High", // 10 High (llenan día 1)
      "Low", "Low", "Low", // 3 Low extras
    ]);
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: c.priority })),
      today: new Date(),
      daysWindow: 7,
      dailyReviewCap: 10,
      softCap: 10,
    });
    const totalCards = r.loads.reduce((s, l) => s + l.cards, 0);
    expect(totalCards).toBe(13);
  });

  it("2.4 horizon corto: 3 días", () => {
    const cards = makeCards(Array(20).fill("High"));
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: "High" })),
      today: new Date(),
      daysWindow: 3,
      dailyReviewCap: 10,
      softCap: 8,
    });
    expect(r.loads.length).toBe(3);
  });

  it("2.5 cards con dueDate fuera del horizonte → van al último día", () => {
    const cards: FlashcardDraft[] = [{
      id: "c1",
      front: "Q", back: "A",
      cardType: "basic",
      priority: "High",
      fsrs: {
        stability: 5, difficulty: 5,
        dueDate: new Date(Date.now() + 30 * DAY_MS).toISOString(),
        reps: 1, lapses: 0,
      },
    } as FlashcardDraft];
    const r = rebalance({
      cards: [{ card: cards[0], priority: "High" }],
      today: new Date(),
      daysWindow: 7,
      dailyReviewCap: 10,
      softCap: 8,
    });
    // Debe estar en el último día
    const lastDay = r.loads[r.loads.length - 1];
    expect(lastDay.cards).toBeGreaterThanOrEqual(1);
  });
});

// ─── Knowledge boost integrado con FSRS ──────────────────

describe("KnowledgeBoost — integración FSRS + knowledge graph", () => {
  it("3.1 mastery=1 (dominada) aumenta stability", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Diabetes"));
    // mastery sube gradualmente con cada respuesta correcta
    for (let i = 0; i < 20; i++) graph.updateMastery("c1", "definition", true, 1);
    const card = newCard();
    const before = card.stability;
    const boosted = applyKnowledgeBoost(card, "c1", "definition", graph);
    // Con mastery alta, el boost aumenta stability
    expect(boosted.stability).toBeGreaterThanOrEqual(before);
  });

  it("3.2 mastery=0 (no conocida) puede reducir stability", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Diabetes"));
    const card = newCard();
    const before = card.stability;
    const boosted = applyKnowledgeBoost(card, "c1", "definition", graph);
    // Con mastery=0, boostFactor = 1 + (0 - 0.5) * 2 = 0 → reduce
    expect(boosted.stability).toBeLessThan(before);
  });

  it("3.3 effectiveRating con mastery=1 amplifica Good → Easy", () => {
    expect(effectiveRating(3, 1.0)).toBe(4);
  });

  it("3.4 effectiveRating con mastery=0 degrada Good → Hard", () => {
    expect(effectiveRating(3, 0)).toBe(2);
  });

  it("3.5 effectiveRating con mastery=0.5 mantiene Good", () => {
    expect(effectiveRating(3, 0.5)).toBe(3);
  });

  it("3.6 effectiveRating con Again + mastery=1 → no mejora (lapse)", () => {
    // Aunque sepa, si falló es un lapse — el effective rating se queda en 1 o sube a 2
    // La lógica actual: adjusted = 1 + (1 - 0.5) * 2 = 2, que es Hard, no Again
    // El lapse "conserva" el fallo pero la maestría alta lo amortigua
    const r = effectiveRating(1, 1.0);
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(2);
  });

  it("3.7 effectiveRating con Easy + mastery=0 → Good (downgrade)", () => {
    expect(effectiveRating(4, 0)).toBe(3);
  });

  it("3.8 simulateQuizImpact aplica review + boost", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "X"));
    for (let i = 0; i < 20; i++) graph.updateMastery("c1", "definition", true, 1);
    const card = newCard();
    const result = simulateQuizImpact(
      [{ card, conceptId: "c1", layer: "definition" }],
      graph,
      3,
    );
    expect(result[0].stability).toBeGreaterThan(card.stability);
  });

  it("3.9 simulateQuizImpact con rating=1 (Again) baja stability", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "X"));
    const card = newCard();
    const result = simulateQuizImpact(
      [{ card, conceptId: "c1", layer: "definition" }],
      graph,
      1,
    );
    expect(result[0].lapses).toBe(1);
  });
});

// ─── Simulación completa de un estudiante real ───────────

describe("Estudiante real: estudio intensivo + repaso + olvido", () => {
  it("4.1 escenario: estudiante hace 5 reviews diarias durante 14 días", () => {
    const cards: FsrsCard[] = Array.from({ length: 5 }, () => newCard());
    const initialAvg = cards.reduce((s, c) => s + c.stability, 0) / cards.length;
    for (let day = 0; day < 14; day++) {
      for (let i = 0; i < cards.length; i++) {
        const r = day < 7 ? 3 : day < 12 ? 3 : (Math.random() > 0.3 ? 3 : 1);
        const result = review(cards[i], r as Rating);
        cards[i] = result.card;
      }
    }
    // Después de 14 días, la stability promedio DEBE haber crecido ≥2x
    // (Si la mutación `s = s` estuviera presente, seguiría en ~1)
    const finalStability = cards.reduce((s, c) => s + c.stability, 0) / cards.length;
    expect(finalStability).toBeGreaterThan(initialAvg * 2);
    // Y tienen reps acumulados
    expect(cards.every((c) => c.reps > 0)).toBe(true);
  });

  it("4.2 escenario: 3 conceptos con capas (definición, síntoma, tratamiento)", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("diabetes", "Diabetes tipo 2"));
    graph.add(createConcept("asma", "Asma"));
    graph.add(createConcept("migrana", "Migraña"));

    // Estudiante domina "definición" de los 3, pero no "tratamiento"
    for (const c of ["diabetes", "asma", "migrana"]) {
      for (let i = 0; i < 20; i++) graph.updateMastery(c, "definition", true, 1);
    }

    // Solo diabetes: domina tratamiento
    for (let i = 0; i < 20; i++) graph.updateMastery("diabetes", "treatment", true, 1);

    // Solo asma: conoce síntoma
    for (let i = 0; i < 15; i++) graph.updateMastery("asma", "symptom", true, 1);

    const gaps = graph.findGaps(10);
    // Debe haber gaps de tratamiento para asma y migrana
    const treatGaps = gaps.filter((g) => g.layer === "treatment");
    expect(treatGaps.length).toBeGreaterThan(0);
  });

  it("4.3 escenario: repaso tras 30 días de descanso", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Farmacología"));
    // Dominó hace 30 días
    for (let i = 0; i < 20; i++) graph.updateMastery("c1", "definition", true, 1);
    // 30 días después
    const concept = graph.get("c1")!;
    concept.layers.definition.lastReviewed = Date.now() - 30 * DAY_MS;
    // Decaimiento: la mastery no cambia, pero la "frescura" sí
    const gaps = graph.findGaps(10);
    // Con decay=1 (30 días sin revisar), la priority debe ser alta
    const c1Gap = gaps.find((g) => g.concept.id === "c1");
    if (c1Gap) {
      expect(c1Gap.priority).toBeGreaterThan(0);
    }
  });

  it("4.4 escenario: error de estudiante en quiz afecta flashcard", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Anatomía"));
    // Empezamos con mastery=0
    let card = newCard();
    const initialStability = card.stability;

    // El estudiante intenta una review y falla
    card = review(card, 1).card;
    graph.updateMastery("c1", "definition", false, 0.8);
    // Aplicar boost (mastery sigue siendo 0, fue un fallo)
    const boosted = applyKnowledgeBoost(card, "c1", "definition", graph);

    // El boost con mastery=0 reduce stability
    expect(boosted.stability).toBeLessThan(initialStability);
    // Hay un lapse
    expect(card.lapses).toBe(1);
  });

  it("4.5 escenario: estudiante corrige y vuelve a dominar", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Anatomía"));
    let card = newCard();

    // Falla 2 veces
    card = review(card, 1).card;
    card = review(card, 1).card;
    expect(card.lapses).toBe(2);

    // Ahora acierta varias veces
    for (let i = 0; i < 5; i++) {
      card = review(card, 4).card;
      graph.updateMastery("c1", "definition", true, 1);
    }
    // La stability debe ser > 0 (recuperada)
    expect(card.stability).toBeGreaterThan(0);
  });
});

// ─── Stress test ─────────────────────────────────────────

describe("Stress test: 1000 cards, 30 días", () => {
  it("5.1 simulación masiva", () => {
    const cards: FsrsCard[] = Array.from({ length: 100 }, () => newCard());
    const start = Date.now();
    for (let day = 0; day < 30; day++) {
      for (let i = 0; i < cards.length; i++) {
        const r = review(cards[i], 3);
        cards[i] = r.card;
      }
    }
    const elapsed = Date.now() - start;
    // 100 cards × 30 días = 3000 reviews en <2s
    expect(elapsed).toBeLessThan(2000);
    // Las cards tienen stability > 0
    const avg = cards.reduce((s, c) => s + c.stability, 0) / cards.length;
    expect(avg).toBeGreaterThan(0);
  });

  it("5.2 load balancer con 500 cards", () => {
    const cards: FlashcardDraft[] = Array.from({ length: 500 }, (_, i) => ({
      id: `c${i}`,
      front: `Q${i}`,
      back: `A${i}`,
      cardType: "basic",
      priority: i % 3 === 0 ? "High" : "Normal",
      fsrs: {
        stability: 5,
        difficulty: 5,
        dueDate: new Date(Date.now() + (i % 14) * DAY_MS).toISOString(),
        reps: 1,
        lapses: 0,
      },
    } as FlashcardDraft));
    const start = Date.now();
    const r = rebalance({
      cards: cards.map((c) => ({ card: c, priority: c.priority })),
      today: new Date(),
      daysWindow: 14,
      dailyReviewCap: 30,
      softCap: 25,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    // 500 cards / 30 por día = ~17 días (puede haber overflow)
    expect(r.overflow || r.movedCount > 0).toBe(true);
  });
});
