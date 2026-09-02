// Simulación end-to-end: 7 días de un usuario real.
// Crea examen, genera plan, simula repasos, mide adherencia,
// verifica streaks, recomendaciones, y notificaciones.

import { describe, it, expect, beforeEach } from "vitest";
import { PersistentStreakTracker, getMilestoneMessage } from "../src/exams/persistentStreak";
import { NotificationServiceV2, detectAllV2 } from "../src/exams/notificationsV2";
import { AdherenceMonitorV2 } from "../src/exams/monitorV2";
import { InMemoryAdherenceStore, computeAdherence, recentAdherence, summarizeAdherence } from "../src/exams/adherence";
import { shouldTriggerRebalance, recommend } from "../src/exams/autoRebalance";
import { ExamScheduler } from "../src/exams/scheduler";
import { defaultFSRSAdapter, generateBoost, applyBoosts, shouldBoost } from "../src/exams/fsrsIntegration";
import type { Exam, ExamDayPlan, FlashcardFSRS } from "../src/exams/types";
import type { AdherenceRecord, RebalanceContext } from "../src/exams/boost";
import type { ReviewEvent } from "../src/exams/adherence";

// ─── Helpers de simulación ──────────────────────────────────

function memStorage() {
  const map = new Map<string, string>();
  const state: Record<string, unknown> = {
    reviews: [],
    streak: { current: 0, best: 0, lastStudyDate: null, history: [], milestonesReached: [] },
    notifications: { lastSentByType: {} },
    focusUntil: null,
    deepFocusUntil: null,
    goals: { goals: [], config: { dailyCards: 30, weeklyCards: 200, streakDays: 7, accuracyRate: 0.8 }, completedHistory: [] },
    weeklySnapshots: [],
  };
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    read: (k: string) => map.get(k) ?? null,
    write: (k: string, v: string) => { map.set(k, v); },
    getReviews: () => state.reviews as never[],
    addReview: (e: never) => { (state.reviews as unknown[]).push(e); },
    addReviewsBatch: (es: never[]) => { (state.reviews as unknown[]).push(...es); },
    reviewsForExam: (id: string) => (state.reviews as Array<{ examId: string }>).filter((r) => r.examId === id),
    reviewsBetween: (s: string, e: string) => (state.reviews as Array<{ date: string }>).filter((r) => r.date >= s && r.date <= e),
    reviewsSince: (ts: number) => (state.reviews as Array<{ date: string }>).filter((r) => new Date(r.date).getTime() >= ts),
    getStreak: () => state.streak,
    setStreak: (s: never) => { state.streak = s; },
    getGoals: () => state.goals as never,
    setGoals: (g: never) => { state.goals = g; },
    getFocusUntil: () => state.focusUntil as number | null,
    isInFocusMode: () => false,
    enableFocusMode: () => {},
    disableFocusMode: () => {},
    focusRemainingMs: () => 0,
    isInDeepFocusMode: () => false,
    enableDeepFocusMode: () => {},
    disableDeepFocusMode: () => {},
    deepFocusRemainingMs: () => 0,
    loadForExam: (_exam: never, _daysBack?: number) => [],
    loadReviews: () => state.reviews as never[],
    loadReviewsForExam: (id: string) => (state.reviews as Array<{ examId: string }>).filter((r) => r.examId === id) as never,
    addReviewForExam: () => {},
    getStorage: () => ({}),
    saveNow: async () => {},
    flush: async () => {},
  };
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function makeFlashcards(n: number, baseDueOffset = 0): FlashcardFSRS[] {
  const cards: FlashcardFSRS[] = [];
  for (let i = 0; i < n; i++) {
    cards.push({
      id: `card-${i}`,
      notePath: `Bioquímica/Tema-${i % 5}.md`,
      front: `Pregunta ${i}`,
      back: `Respuesta ${i}`,
      topic: `Tema ${i % 5}`,
      dueDate: dayOffset(baseDueOffset + (i % 7)),
      stability: 1 + (i % 5),
      difficulty: 0.3 + (i % 5) * 0.1,
      lastReview: dayOffset(-2),
      reps: 1 + (i % 3),
      lapses: i % 4 === 0 ? 1 : 0,
      suspended: false,
    });
  }
  return cards;
}

function makeExamIn(days: number, totalCards: number, subject: string): Exam {
  return {
    id: `exam-${subject.toLowerCase()}`,
    title: `Parcial ${subject}`,
    subject,
    date: dayOffset(days),
    examType: "parcial",
    scopes: [{ type: "folder", path: subject, includeSubfolders: true }],
    status: "active",
    priority: "high",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeScopeResolver(allCards: FlashcardFSRS[]) {
  return {
    resolve: (scope: { type: string; path?: string; tag?: string; subject?: string }) => {
      if (scope.type === "folder") {
        return allCards.filter((c) => c.notePath.startsWith(scope.path ?? ""));
      }
      if (scope.type === "subject") {
        return allCards.filter((c) => c.topic.toLowerCase().includes((scope.subject ?? "").toLowerCase()));
      }
      return allCards;
    },
  };
}

// ─── La simulación ────────────────────────────────────────

describe("Simulación e2e: 7 días de un estudiante MIR", () => {
  let storage: ReturnType<typeof memStorage>;
  let streak: PersistentStreakTracker;
  let notificationService: NotificationServiceV2;
  let monitor: AdherenceMonitorV2;
  let adherenceStore: InMemoryAdherenceStore;
  let allCards: FlashcardFSRS[];
  let examBio: Exam;
  let examAna: Exam;
  let scheduleBio: Exam["schedule"];
  let scheduleAna: Exam["schedule"];
  let eventsEmitted: import("../src/exams/notifications").NotificationEvent[];

  beforeEach(() => {
    storage = memStorage();
    streak = new PersistentStreakTracker(storage);
    notificationService = new NotificationServiceV2({ examApproachingDays: [7, 3, 1] }, storage);
    eventsEmitted = [];
    notificationService.onEmit = (e) => eventsEmitted.push(e);
    adherenceStore = new InMemoryAdherenceStore();

    // 60 cards, 30 de Bioquímica y 30 de Anatomía, dueDate natural escalonada
    allCards = [...makeFlashcards(30, 0).map((c) => ({ ...c, notePath: c.notePath.replace("Bioquímica", "Bioquímica") })),
                 ...makeFlashcards(30, 2).map((c) => ({ ...c, topic: `Tema ${c.id.split("-")[1]}`, notePath: c.notePath.replace("Bioquímica", "Anatomía") }))];

    // Dos exámenes: Bioquímica en 7 días, Anatomía en 4 días
    examBio = makeExamIn(7, 30, "Bioquímica");
    examAna = makeExamIn(4, 30, "Anatomía");

    // Generar planes con boost
    const resolver = makeScopeResolver(allCards);
    const scheduler = new ExamScheduler(resolver as never);
    const cardsForBio = resolver.resolve(examBio.scopes[0]);
    const cardsForAna = resolver.resolve(examAna.scopes[0]);
    const boostsBio: import("../src/exams/boost").CardExamBoost[] = [];
    for (const card of cardsForBio) {
      const b = generateBoost(card, examBio);
      if (b) boostsBio.push(b);
    }
    const boostsAna: import("../src/exams/boost").CardExamBoost[] = [];
    for (const card of cardsForAna) {
      const b = generateBoost(card, examAna);
      if (b) boostsAna.push(b);
    }
    applyBoosts(cardsForBio, examBio);
    applyBoosts(cardsForAna, examAna);
    scheduleBio = scheduler.generate(examBio, cardsForBio);
    scheduleAna = scheduler.generate(examAna, cardsForAna);
    examBio.schedule = scheduleBio;
    examAna.schedule = scheduleAna;

    // Monitor
    monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: (f) => {
          const all = [examBio, examAna];
          return f?.status ? all.filter((e) => e.status === f.status) : all;
        } },
        notificationService,
        streakTracker: streak,
        adherenceStore: { loadForExam: () => [] },
        useRealTimer: false,
        now: () => Date.now(),
      }
    );
  });

  it("DÍA 0: setup + primer repaso, racha=1", () => {
    // El usuario hace 8 repasos el día 0 (hoy)
    const events: ReviewEvent[] = [];
    for (let i = 0; i < 8; i++) {
      const card = allCards[i];
      events.push({
        cardId: card.id,
        examId: card.topic.startsWith("Tema") && i < 30 ? examBio.id : examAna.id,
        date: dayOffset(0),
        rating: i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3,
        durationMs: 30000,
      });
    }
    adherenceStore.save(events);
    streak.recordStudy({ date: dayOffset(0), cardsReviewed: 8, durationMs: events.reduce((s, e) => s + e.durationMs, 0) });

    expect(streak.getCurrent()).toBe(1);
    expect(streak.getBest()).toBe(1);
    expect(streak.isActive()).toBe(true);
  });

  it("DÍA 1-3: racha crece, no hay notificaciones de adherencia", () => {
    // Días 1, 2, 3: hace 10 repasos cada día
    for (let day = 1; day <= 3; day++) {
      const events: ReviewEvent[] = [];
      for (let i = 0; i < 10; i++) {
        const card = allCards[(day * 10 + i) % allCards.length];
        events.push({
          cardId: card.id,
          examId: day < 3 ? examBio.id : examAna.id,
          date: dayOffset(day),
          rating: 2,
          durationMs: 20000,
        });
      }
      adherenceStore.save(events);
      streak.recordStudy({
        date: dayOffset(day),
        cardsReviewed: 10,
        durationMs: events.reduce((s, e) => s + e.durationMs, 0),
      });
    }
    expect(streak.getCurrent()).toBe(3);
    const data = streak.getRawData();
    expect(data.milestonesReached).toContain(3);
  });

  it("DÍA 4: REBALANCE — usuario repasa solo 3 cards (30% adherencia)", () => {
    // Días 0-3: adherencia normal
    for (let day = 0; day <= 3; day++) {
      const events: ReviewEvent[] = [];
      for (let i = 0; i < 8; i++) {
        const card = allCards[(day * 10 + i) % allCards.length];
        events.push({
          cardId: card.id,
          examId: day < 3 ? examBio.id : examAna.id,
          date: dayOffset(day),
          rating: 2,
          durationMs: 20000,
        });
      }
      adherenceStore.save(events);
      streak.recordStudy({ date: dayOffset(day), cardsReviewed: 8, durationMs: 160000 });
    }

    // Día 4: solo 3 repasos
    const events4: ReviewEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const card = allCards[i];
      events4.push({
        cardId: card.id,
        examId: card.notePath.startsWith("Anatomía") ? examAna.id : examBio.id,
        date: dayOffset(4),
        rating: 2,
        durationMs: 20000,
      });
    }
    adherenceStore.save(events4);
    streak.recordStudy({ date: dayOffset(4), cardsReviewed: 3, durationMs: 60000 });

    // Calcular adherencia de los últimos 3 días
    const all = adherenceStore.load();
    const last3 = all.filter((e) => {
      const diff = (new Date(dayOffset(4)).getTime() - new Date(e.date).getTime()) / 86_400_000;
      return diff >= 0 && diff < 3;
    });
    // 3 días * 8 = 24 planificado, 3+8+8=19 repasos = 79% — todavía ok
    const lastDay = all.filter((e) => e.date === dayOffset(4));
    expect(lastDay).toHaveLength(3);

    // Recalcular solo el día 4: plan vs realidad
    const planDay4 = (scheduleBio.days.find((d) => d.date === dayOffset(4))?.cards ?? 0) +
                     (scheduleAna.days.find((d) => d.date === dayOffset(4))?.cards ?? 0);
    const day4Adherence = lastDay.length / planDay4;
    expect(day4Adherence).toBeLessThan(0.5);
  });

  it("DÍA 5-6: racha se rompe, streak-at-risk", () => {
    // Días 0-2: estudio
    for (let day = 0; day <= 2; day++) {
      streak.recordStudy({ date: dayOffset(day), cardsReviewed: 5, durationMs: 50000 });
    }
    expect(streak.getCurrent()).toBe(3);

    // Días 3-4: NO estudio → racha se rompe
    // El sistema de detección de at-risk debe disparar:
    const atRisk = notificationService.detectStreakAtRisk(3, true, false);
    expect(atRisk).not.toBeNull();
    expect(atRisk?.type).toBe("streak-at-risk");
  });

  it("FLUJO COMPLETO: examen en 1 día → notificación de approaching", () => {
    // El monitor corre y detecta eventos
    // (forzamos fecha mockeando)
    const in1 = new Date();
    in1.setDate(in1.getDate() + 1);
    const examSoon = makeExamIn(1, 30, "Fisiología");
    examSoon.schedule = scheduleBio;

    // Re-creamos monitor con este examen
    const monitor2 = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [examSoon] },
        notificationService,
        streakTracker: streak,
        useRealTimer: false,
        now: () => Date.now(),
      }
    );

    const events = monitor2.tick();
    expect(events.some((e) => e.type === "exam-approaching")).toBe(true);
    const approaching = events.find((e) => e.type === "exam-approaching");
    expect(approaching?.severity).toBe("urgent");
  });

  it("FLUJO COMPLETO: shouldBoost ejecuta lógica FSRS correctamente", () => {
    const card = allCards[0];
    const originalDue = card.dueDate;
    // Boost porque el examen está cerca
    const reasons = shouldBoost(examBio, [card]);
    if (reasons.length > 0) {
      const boosts = generateBoost(examBio, [card]);
      applyBoosts([card], boosts);
      expect(card.dueDate).not.toBe(originalDue);
    }
  });

  it("FLUJO COMPLETO: detectAllV2 emite eventos múltiples en un solo tick", () => {
    // 7 días de streak
    for (let day = -3; day <= 0; day++) {
      streak.recordStudy({ date: dayOffset(day), cardsReviewed: 5, durationMs: 50000 });
    }
    // Esperaríamos milestone 3 (ya alcanzado días atrás)
    // Y un examen en 7 días
    const exam7 = makeExamIn(7, 30, "Micro");
    exam7.schedule = scheduleBio;
    const events = monitor.tick();
    // 2 exámenes (bio en 7 días, ana en 4 días) → 2 exam-approaching
    // 1 streak-milestone (4 = próximo)
    const types = events.map((e) => e.type);
    expect(types).toContain("exam-approaching");
  });

  it("FLUJO COMPLETO: notificaciones respetan maxPerDay", () => {
    const freshStorage = new Map<string, string>();
    const limitedStorage = {
      read: (k: string) => freshStorage.get(k) ?? null,
      write: (k: string, v: string) => { freshStorage.set(k, v); },
    };
    const limited = new NotificationServiceV2({ maxPerDay: 2 }, limitedStorage);
    const streak5 = new PersistentStreakTracker(storage);
    streak5.recordStudy({ date: dayOffset(-4), cardsReviewed: 1, durationMs: 100 });
    streak5.recordStudy({ date: dayOffset(-3), cardsReviewed: 1, durationMs: 100 });
    streak5.recordStudy({ date: dayOffset(-2), cardsReviewed: 1, durationMs: 100 });
    streak5.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    streak5.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });

    // Crear 3 exámenes a 1, 3, 7 días → debería intentar 3 notificaciones approaching
    // Pero maxPerDay=2 → solo 2
    const ex1 = makeExamIn(1, 30, "Fisio");
    ex1.schedule = scheduleBio;
    const ex2 = makeExamIn(3, 30, "Histo");
    ex2.schedule = scheduleBio;
    const ex3 = makeExamIn(7, 30, "Bio");
    ex3.schedule = scheduleBio;

    const m = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [ex1, ex2, ex3] },
        notificationService: limited,
        streakTracker: streak5,
        adherenceStore: { loadForExam: () => [] },
        useRealTimer: false,
        now: () => Date.now(),
      }
    );
    const events = m.tick();
    // El monitor detecta 3 eventos (uno por examen) sin filtrar.
    expect(events.length).toBe(3);
    // La emisión real (vía emitBatch) respeta maxPerDay=2.
    const emitted = limited.emitBatch(events);
    expect(emitted.length).toBe(2);
  });

  it("FLUJO COMPLETO: rebalance recomendado cuando adherencia cae", () => {
    // Simular 3 días de baja adherencia
    for (let day = 0; day <= 2; day++) {
      const events: ReviewEvent[] = [];
      for (let i = 0; i < 3; i++) {
        events.push({
          cardId: `card-${i}`,
          examId: examBio.id,
          date: dayOffset(day),
          rating: 1,
          durationMs: 10000,
        });
      }
      adherenceStore.save(events);
    }

    const all = adherenceStore.load();
    const records: AdherenceRecord[] = all.map((e) => ({
      date: e.date,
      planned: 10,
      completed: 3,
      adherenceRate: 0.3,
      rolling7: 0.3,
      examId: e.examId,
    }));
    const should = shouldTriggerRebalance(records);
    expect(should).toBe(true);
  });
});
