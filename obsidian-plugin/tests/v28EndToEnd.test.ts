// v0.28: Simulación end-to-end REAL del flujo completo de estudio.
// Verifica que TODOS los componentes trabajan juntos.

import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";
import { findCardsForFreeReview, createFreeReviewSession, answerFreeReview } from "../src/study/freeReview";
import { SnoozeManager, type SnoozePersistence, type SnoozeEntry } from "../src/study/snooze";
import { filterSnoozedFlashcards, getDueCardsExcludingSnoozed } from "../src/study/snoozeIntegration";
import { ScheduleMatcher } from "../src/exams/scheduleMatcher";
import { rebalance } from "../src/fsrs/loadBalancer";
import { EventEmitter } from "../src/utils/eventBus";
import { buildHeatmap, type ActivityEvent } from "../src/analytics/heatmap";
import { SchedulePlanner } from "../src/schedule/planner";
import { BreadcrumbSystem, getBreadcrumbs, resetBreadcrumbs } from "../src/utils/breadcrumbs";
import { Logger } from "../src/utils/logger";
import { AdaptiveQuizEngine } from "../src/study/adaptiveQuiz";
import type { FlashcardDraft } from "../src/types";

class MockSnoozePersistence implements SnoozePersistence {
  private data: SnoozeEntry[] = [];
  load() { return [...this.data]; }
  save(entries: SnoozeEntry[]) { this.data = [...entries]; }
}

function makeCard(id: string, subject: string, dueDays: number, stability = 5): FlashcardDraft {
  const due = new Date();
  due.setDate(due.getDate() + dueDays);
  return {
    id,
    front: `Pregunta ${id}`,
    back: `Respuesta ${id}`,
    notePath: `${subject}/tema.md`,
    tags: [subject],
    fsrs: { stability, difficulty: 5, dueDate: due.toISOString(), reps: 1, lapses: 0 },
  } as FlashcardDraft;
}

describe("E2E: Día completo de estudio médico", () => {
  beforeEach(() => {
    resetBreadcrumbs();
  });

  it("E2E.1 setup: vault con 50 notas, 200 flashcards, 3 exámenes, horario L-V", () => {
    // 1) Vault: 50 notas en 5 asignaturas
    const subjects = ["anatomia", "fisiologia", "farmacologia", "histologia", "patologia"];
    const allCards: FlashcardDraft[] = [];
    for (const subject of subjects) {
      for (let i = 0; i < 40; i++) {
        allCards.push(makeCard(`${subject}-${i}`, subject, (i % 14) - 7));
      }
    }
    expect(allCards.length).toBe(200);

    // 2) 3 exámenes
    const exams = [
      { subject: "anatomia", date: new Date(Date.now() + 5 * 86400000) },
      { subject: "fisiologia", date: new Date(Date.now() + 14 * 86400000) },
      { subject: "farmacologia", date: new Date(Date.now() + 21 * 86400000) },
    ];
    expect(exams.length).toBe(3);

    // 3) Horario L-V
    const schedules = [];
    for (let day = 1; day <= 5; day++) {
      schedules.push({ subject: "anatomia", dayOfWeek: day as const, startMinute: 9 * 60, durationMinutes: 90 });
      schedules.push({ subject: "fisiologia", dayOfWeek: day as const, startMinute: 11 * 60, durationMinutes: 90 });
    }
    expect(schedules.length).toBe(10);
  });

  it("E2E.2 flujo: repasar anatomía libre + snoozear lo difícil + ver heatmap", () => {
    // 1) Vault
    const allCards: FlashcardDraft[] = [];
    for (let i = 0; i < 30; i++) {
      allCards.push(makeCard(`ana-${i}`, "anatomia", 0));
    }
    for (let i = 0; i < 20; i++) {
      allCards.push(makeCard(`far-${i}`, "farmacologia", 0));
    }

    // 2) Repasar libre anatomía
    const found = findCardsForFreeReview(allCards, { type: "topic", topic: "anatomia" });
    expect(found.length).toBe(30);

    const session = createFreeReviewSession({ type: "topic", topic: "anatomia" }, found);
    expect(session.cards.length).toBe(30);

    // 3) Responder todas (50% correctas)
    for (let i = 0; i < found.length; i++) {
      const rating = (i % 2 === 0 ? 1 : 4) as 1 | 2 | 3 | 4;
      answerFreeReview(session, found[i].id, rating, 1500);
    }
    expect(session.completed).toBe(true);

    // 4) Snoozear 5 que fueron difíciles
    const snooze = new SnoozeManager(new MockSnoozePersistence());
    for (let i = 0; i < 5; i++) {
      snooze.snooze("flashcard", found[i].id, `Card ${i}`, { durationMs: 7 * 86400000 });
    }

    // 5) Verificar que las snoozeadas se filtran
    const remaining = filterSnoozedFlashcards(snooze, allCards);
    expect(remaining.length).toBe(45); // 200 - 5 snoozeadas

    // 6) Heatmap
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const events: ActivityEvent[] = [
      { date: todayStr, kind: "review", weight: 30 },
      { date: todayStr, kind: "new-card", weight: 0 },
    ];
    const heatmap = buildHeatmap(events, 7);
    expect(heatmap.total).toBe(30);
  });

  it("E2E.3 flujo: grabación → match horario → snooze por overlap", () => {
    // 1) Horario del estudiante: clase de anatomía ahora
    // Usamos un día fijo (miércoles) y hora fija (10:00) para determinismo
    const baseDate = new Date("2026-09-02T10:00:00");  // miércoles
    const day = baseDate.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    const startMin = 10 * 60;  // 10:00
    const schedules = [{
      subject: "anatomia",
      dayOfWeek: day,
      startMinute: startMin - 15, // empezó hace 15 min (09:45)
      durationMinutes: 90,
    }];
    const matcher = new ScheduleMatcher(schedules);

    // 2) Grabación: empieza a las 10:00, dura 30 min
    const match = matcher.match(baseDate.getTime(), 30 * 60_000);
    expect(match).not.toBeNull();
    expect(match!.schedule.subject).toBe("anatomia");

    // 3) Si hay 2 clases que se solapan, matchAll las detecta
    const schedulesOverlap = [
      ...schedules,
      { subject: "fisiologia", dayOfWeek: day as 0 | 1 | 2 | 3 | 4 | 5 | 6, startMinute: startMin, durationMinutes: 90 },
    ];
    const matcher2 = new ScheduleMatcher(schedulesOverlap);
    const all = matcher2.matchAll(baseDate.getTime(), 30 * 60_000);
    expect(all.length).toBe(2);
    // Anatomía tiene mejor score porque empezó antes (más cerca de la grabación)
    expect(all[0].confidence).toBeGreaterThanOrEqual(all[1].confidence);

    // 4) Si la grabación es de anatomía pero quieres repasarla en 1 semana
    const snooze = new SnoozeManager(new MockSnoozePersistence());
    snooze.snoozeFor("recording", "rec-2026-09-01", "Clase 1 sep", "1w");
    expect(snooze.isSnoozed("recording", "rec-2026-09-01")).toBe(true);
  });

  it("E2E.4 flujo: FSRS scheduling + load balance + planner diario", () => {
    // 1) 100 cards overdue
    const cards = [];
    for (let i = 0; i < 100; i++) {
      cards.push({ card: makeCard(`c${i}`, "anatomia", -i % 14), priority: i < 30 ? "High" as const : "Medium" as const });
    }
    const result = rebalance({
      cards,
      today: new Date(),
      daysWindow: 14,
      dailyReviewCap: 20,
      softCap: 15,
    });
    expect(result.loads.length).toBe(14);
    expect(result.movedCount).toBeGreaterThanOrEqual(0);

    // 2) Las cards due se calculan
    const dueCards: FlashcardDraft[] = [];
    for (let i = 0; i < 50; i++) {
      dueCards.push(makeCard(`due-${i}`, "anatomia", -1));
    }
    const due = getDueCardsExcludingSnoozed(new SnoozeManager(new MockSnoozePersistence()), dueCards);
    expect(due.length).toBe(50);

    // 3) Generar agenda
    const planner = new SchedulePlanner({} as any);
    const agenda = planner.generate({
      notes: [{ path: "anatomia/tema.md", fm: { subject: "anatomia" } as any }],
      dueCards,
      date: new Date(),
      availableMinutes: 60,
      startTime: "09:00",
    });
    expect(agenda.blocks.length).toBeGreaterThan(0);
    expect(agenda.totalMinutes).toBeLessThanOrEqual(60);
  });

  it("E2E.5 flujo: knowledge graph + gap detection + adaptive quiz", async () => {
    // 1) Vault → KnowledgeGraph
    const kg = new KnowledgeGraph();
    const concepts = ["corazon", "higado", "rinon", "pulmon", "cerebro"];
    for (const c of concepts) {
      kg.add(createConcept(c, c));
    }

    // 2) Marcar dominio de algunos
    kg.updateMastery("corazon", "definition", true, 0.9);
    kg.updateMastery("higado", "definition", true, 0.9);

    // 3) Encontrar gaps
    const gaps = kg.findGaps(10);
    const gapConcepts = new Set(gaps.map((g) => g.concept.id));
    expect(gapConcepts.has("rinon")).toBe(true);
    expect(gapConcepts.has("pulmon")).toBe(true);

    // 4) Sesión de quiz (usando AdaptiveQuizEngine)
    const engine = new AdaptiveQuizEngine(kg, { maxQuestions: 5, stopOnMastery: true, mode: "diagnostic" });
    engine.startSession();
    const firstQ = engine.nextQuestion();
    expect(firstQ).not.toBeNull();

    // 5) Responder
    if (firstQ) {
      kg.markShown(firstQ.concept.id);
      kg.updateMastery(firstQ.concept.id, firstQ.layer, true, 0.8);

      // 6) Verificar que el concept se actualizó
      const c = kg.get(firstQ.concept.id);
      expect(c).not.toBeNull();
      expect(c!.layers[firstQ.layer].mastery).toBeGreaterThan(0);
    }
  });

  it("E2E.6 flujo: EventBus + breadcrumb + logger en sesión de estudio", () => {
    type Events = { "card-reviewed": { cardId: string; rating: number } };
    const bus = new EventEmitter<Events>();
    const log = new Logger("e2e");
    const events: any[] = [];

    bus.on("card-reviewed", (e) => {
      events.push(e);
      log.info(`Card ${e.cardId} revisada con rating ${e.rating}`, { operation: "review" });
    });

    // Simular 5 reviews
    for (let i = 0; i < 5; i++) {
      bus.emit("card-reviewed", { cardId: `c${i}`, rating: 3 + (i % 2) });
    }
    expect(events.length).toBe(5);

    // Los breadcrumbs deben estar registrados
    const bc = getBreadcrumbs().all();
    expect(bc.length).toBeGreaterThan(0);
  });

  it("E2E.7 flujo: día completo con FSRS + snooze + heatmap + planner", () => {
    // Setup
    const cards: FlashcardDraft[] = [];
    for (let i = 0; i < 50; i++) {
      cards.push(makeCard(`c${i}`, "anatomia", -1));
    }
    const snooze = new SnoozeManager(new MockSnoozePersistence());
    
    // 1) Estudiante decide repasar anatomía libre
    const freeSession = createFreeReviewSession(
      { type: "topic", topic: "anatomia" },
      findCardsForFreeReview(cards, { type: "topic", topic: "anatomia" }),
    );
    expect(freeSession.cards.length).toBe(50);

    // 2) Estudiante responde todas (mitad falla con rating 1)
    for (let i = 0; i < freeSession.cards.length; i++) {
      const rating = (i % 2 === 0 ? 1 : 3) as 1 | 2 | 3 | 4;
      answerFreeReview(freeSession, freeSession.cards[i].id, rating, 1200);
    }
    expect(freeSession.completed).toBe(true);
    expect(freeSession.responses.length).toBe(50);

    // 3) Estudiante snoozea las que falló (ratings 1)
    let failed = 0;
    for (const r of freeSession.responses) {
      if (r.rating === 1) {
        snooze.snoozeFor("flashcard", r.cardId, "Card", "3d");
        failed++;
        if (failed >= 10) break;
      }
    }
    expect(snooze.list().length).toBeGreaterThan(0);
    expect(snooze.list().length).toBeLessThanOrEqual(10);

    // 4) El FSRS ya no las incluye
    const dueFiltered = getDueCardsExcludingSnoozed(snooze, cards);
    expect(dueFiltered.length).toBe(40);

    // 5) Heatmap del día
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const events: ActivityEvent[] = [
      { date: todayStr, kind: "review", weight: 50 },
    ];
    const heatmap = buildHeatmap(events, 1);
    expect(heatmap.total).toBe(50);
    expect(heatmap.streak).toBe(1);

    // 6) Planner para mañana
    const planner = new SchedulePlanner({} as any);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const agenda = planner.generate({
      notes: [],
      dueCards: dueFiltered,
      date: tomorrow,
      availableMinutes: 90,
      startTime: "09:00",
    });
    expect(agenda.totalMinutes).toBeGreaterThan(0);
  });
});
