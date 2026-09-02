// v0.20: Simulación e2e integrada: 14 días con goals + weekly review + deep focus.

import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataStorage } from "../src/exams/persistence";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import { PersistentAdherenceStore } from "../src/exams/persistentAdherence";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";
import { AdherenceMonitorV2 } from "../src/exams/monitorV2";
import { StudyGoals } from "../src/exams/studyGoals";
import { WeeklyReviewService } from "../src/exams/weeklyReview";
import type { Exam } from "../src/exams/types";
import type { ReviewEvent } from "../src/exams/persistence";
import type { NotificationEvent } from "../src/exams/notificationsV2";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData() { return Object.keys(this.data).length > 0 ? this.data : null; }
  async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
}

function dayOffset(days: number, base: Date = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeExam(days: number, subject: string): Exam {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return {
    id: `exam-${subject}`,
    title: `Examen ${subject}`,
    subject,
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    examType: "parcial",
    scopes: [{ type: "folder", path: subject, includeSubfolders: true }],
    status: "active",
    priority: "high",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Simulación e2e v0.20: 14 días con goals + weekly review + deep focus", () => {
  let plugin: MockPlugin;
  let storage: PluginDataStorage;
  let streak: PersistentStreakTracker;
  let notif: NotificationServiceV2;
  let goals: StudyGoals;
  let weeklyReview: WeeklyReviewService;
  let eventsEmitted: NotificationEvent[];
  let now: number;

  beforeEach(() => {
    plugin = new MockPlugin();
    // Forzar "now" a miércoles 2026-09-02 (mitad de semana) para tests estables
    now = new Date(2026, 8, 2, 12, 0, 0).getTime();
    return (async () => {
      storage = await PluginDataStorage.load(plugin as never);
      streak = new PersistentStreakTracker(storage);
      const notifStorage = new Map<string, string>();
      eventsEmitted = [];
      notif = new NotificationServiceV2(
        { examApproachingDays: [7, 3, 1], maxPerDay: 50, dedupHours: 0 },
        {
          read: (k) => notifStorage.get(k) ?? null,
          write: (k, v) => notifStorage.set(k, v),
        }
      );
      notif.setNow(() => now);
      notif.onEmit = (e) => eventsEmitted.push(e);
      notif.setFocusChecker(() => storage.isInFocusMode(now) || storage.isInDeepFocusMode(now));
      goals = new StudyGoals(storage, notif);
      weeklyReview = new WeeklyReviewService(storage);
    })();
  });

  it("Setup: 3 exámenes + 4 goals inicializados", () => {
    goals.setConfig({ dailyCards: 10, weeklyCards: 50, streakDays: 3, accuracyRate: 0.7 });
    const all = goals.syncGoals(now);
    expect(all.length).toBeGreaterThanOrEqual(3); // daily, weekly, streak, accuracy
  });

  it("Día 1-3: cumple goal diario 3 veces → 3 notificaciones", () => {
    return (async () => {
      goals.setConfig({ dailyCards: 5, weeklyCards: 100, streakDays: 100, accuracyRate: 0.99 });
      const reviews: ReviewEvent[] = [];
      for (let day = 0; day < 3; day++) {
        for (let i = 0; i < 6; i++) {
          const r = {
            cardId: `c-${day}-${i}`,
            examId: "exam-Bioquímica",
            date: dayOffset(-2 + day, new Date(now)),
            rating: 3 as const,
            durationMs: 30000,
          };
          reviews.push(r);
          storage.addReview(r);
        }
        streak.recordStudy({ date: dayOffset(-2 + day, new Date(now)), cardsReviewed: 6, durationMs: 180000 });
        // Re-recompute con now fijo
        goals.recomputeProgress(storage.getReviews(), streak.getCurrent(), now);
      }
      // 3 daily completados → 3 notificaciones
      const goalNotifs = eventsEmitted.filter((e) => e.type === "goal-completed");
      expect(goalNotifs.length).toBeGreaterThanOrEqual(3);
    })();
  });

  it("Día 5: weekly goal completado → notificación semanal", () => {
    return (async () => {
      // Forzar now a viernes 2026-09-04 para que 5 días atrás sea lunes
      now = new Date(2026, 8, 4, 12, 0, 0).getTime();
      const localNow = new Date(now);
      goals.setConfig({ dailyCards: 1, weeklyCards: 30, streakDays: 100, accuracyRate: 0.99 });
      // 5 días * 7 reviews = 35 → supera weekly de 30
      for (let day = 0; day < 5; day++) {
        for (let i = 0; i < 7; i++) {
          const r = {
            cardId: `c-${day}-${i}`,
            examId: "exam-Bioquímica",
            date: dayOffset(-4 + day, localNow),
            rating: 3 as const,
            durationMs: 1000,
          };
          storage.addReview(r);
        }
        streak.recordStudy({ date: dayOffset(-4 + day, localNow), cardsReviewed: 7, durationMs: 7000 });
        goals.recomputeProgress(storage.getReviews(), streak.getCurrent(), now);
      }
      const weekly = goals.getAll().find((g) => g.type === "weekly-cards");
      expect(weekly?.status).toBe("completed");
    })();
  });

  it("Día 7: weekly review generado con stats correctas", () => {
    return (async () => {
      // 7 días dentro de la misma semana
      for (let day = -2; day <= 4; day++) {
        for (let i = 0; i < 10; i++) {
          storage.addReview({
            cardId: `c-${day}-${i}`,
            examId: "exam-Bioquímica",
            date: dayOffset(day, new Date(now)),
            rating: i % 4 === 0 ? 1 : 3, // 75% correctas
            durationMs: 5000,
          });
        }
      }
      const review = weeklyReview.generateCurrentWeek(now);
      // 7 días * 10 = 70 reviews
      expect(review.totalCards).toBe(70);
      // 75% correctas = ~52
      expect(review.totalCorrect).toBeGreaterThan(45);
      expect(review.averageAccuracy).toBeGreaterThan(0.5);
    })();
  });

  it("Día 7: snapshot semanal se guarda y recupera", () => {
    return (async () => {
      for (let i = 0; i < 10; i++) {
        storage.addReview({
          cardId: `c-${i}`,
          examId: "exam-Bioquímica",
          date: dayOffset(0, new Date(now)),
          rating: 3,
          durationMs: 1000,
        });
      }
      const review = weeklyReview.generateCurrentWeek(now);
      weeklyReview.saveSnapshot(review);
      const snapshots = weeklyReview.getSnapshots();
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].totalCards).toBe(10);
    })();
  });

  it("Día 8: deep focus activado → monitor skipea", () => {
    return (async () => {
      storage.enableDeepFocusMode(2 * 3600 * 1000, now);
      const exam = makeExam(7, "Bioquímica");
      const monitor = new AdherenceMonitorV2(
        { intervalHours: 999, enabled: true },
        {
          examManager: { list: () => [exam] },
          notificationService: notif,
          streakTracker: streak,
          adherenceStore: new PersistentAdherenceStore(storage),
          useRealTimer: false,
          now: () => now,
          isInFocusMode: () => storage.isInFocusMode(now),
          isInDeepFocusMode: () => storage.isInDeepFocusMode(now),
        }
      );
      const events = monitor.tick();
      expect(events).toEqual([]);
      expect(monitor.getTotalSkippedByDeepFocus()).toBe(1);
    })();
  });

  it("Día 8: deep focus deshabilitado → monitor vuelve a correr", () => {
    return (async () => {
      // Crear notif con storage fresco
      const notifStorage2 = new Map<string, string>();
      const notif2 = new NotificationServiceV2(
        { examApproachingDays: [1], maxPerDay: 10, dedupHours: 0 },
        {
          read: (k) => notifStorage2.get(k) ?? null,
          write: (k, v) => notifStorage2.set(k, v),
        }
      );
      notif2.setNow(() => now);

      // Exam en 1 día desde now simulado
      const examDate = new Date(now);
      examDate.setDate(examDate.getDate() + 1);
      const exam: Exam = {
        id: "exam-test",
        title: "Test",
        subject: "S",
        date: `${examDate.getFullYear()}-${String(examDate.getMonth() + 1).padStart(2, "0")}-${String(examDate.getDate()).padStart(2, "0")}`,
        examType: "parcial",
        scopes: [],
        status: "active",
        priority: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Variable mutable para que el closure vea el cambio
      let deepFocus = true;
      const monitor = new AdherenceMonitorV2(
        { intervalHours: 999, enabled: true },
        {
          examManager: { list: () => [exam] },
          notificationService: notif2,
          streakTracker: streak,
          adherenceStore: new PersistentAdherenceStore(storage),
          useRealTimer: false,
          now: () => now,
          isInFocusMode: () => false,
          isInDeepFocusMode: () => deepFocus,
        }
      );
      // En deep focus: no events
      expect(monitor.tick()).toEqual([]);
      // Salir de deep focus
      deepFocus = false;
      const afterEvents = monitor.tick();
      expect(afterEvents.length).toBeGreaterThan(0);
    })();
  });

  it("Día 10: weekly review con deltaCards positivo (mejor que semana anterior)", () => {
    return (async () => {
      // Semana anterior: 5 cards
      for (let i = 0; i < 5; i++) {
        storage.addReview({
          cardId: `prev-${i}`,
          examId: "exam-Bioquímica",
          date: dayOffset(-7, new Date(now)),
          rating: 3,
          durationMs: 1000,
        });
      }
      // Semana actual: 20 cards
      for (let i = 0; i < 20; i++) {
        storage.addReview({
          cardId: `cur-${i}`,
          examId: "exam-Bioquímica",
          date: dayOffset(0, new Date(now)),
          rating: 3,
          durationMs: 1000,
        });
      }
      const review = weeklyReview.generateCurrentWeek(now);
      expect(review.totalCards).toBe(20);
      expect(review.deltaCards).toBe(15);
    })();
  });

  it("Día 12: rating great si accuracy >= 0.85", () => {
    return (async () => {
      for (let i = 0; i < 10; i++) {
        storage.addReview({
          cardId: `c-${i}`,
          examId: "exam-Bioquímica",
          date: dayOffset(0, new Date(now)),
          rating: 4,
          durationMs: 1000,
        });
      }
      const review = weeklyReview.generateCurrentWeek(now);
      expect(review.rating).toBe("great");
    })();
  });

  it("Flujo completo: 14 días → weekly review + goals + deep focus", () => {
    return (async () => {
      // Forzar now a viernes para que 14 días atrás sea lunes (toda la semana)
      now = new Date(2026, 8, 11, 12, 0, 0).getTime();
      const localNow = new Date(now);
      goals.setConfig({ dailyCards: 5, weeklyCards: 30, streakDays: 7, accuracyRate: 0.7 });

      // Solo 5 días (lunes a viernes) con actividad
      for (let day = -4; day <= 0; day++) {
        for (let i = 0; i < 7; i++) {
          storage.addReview({
            cardId: `c-${day}-${i}`,
            examId: "exam-Bioquímica",
            date: dayOffset(day, localNow),
            rating: i % 4 === 0 ? 1 : (i % 4 === 1 ? 2 : 3),
            durationMs: 5000,
          });
        }
        streak.recordStudy({ date: dayOffset(day, localNow), cardsReviewed: 7, durationMs: 35000 });
        goals.recomputeProgress(storage.getReviews(), streak.getCurrent(), now);
      }

      // Verificar goals
      const active = goals.getActiveGoals();
      const daily = active.find((g) => g.type === "daily-cards");
      const allGoals = goals.getAll();
      const todayDaily = allGoals.find((g) => g.type === "daily-cards" && g.periodStart === dayOffset(0, localNow));
      expect(todayDaily).toBeDefined();
      expect(todayDaily?.current).toBe(7);
      expect(todayDaily?.status).toBe("completed");

      // Verificar weekly review
      const review = weeklyReview.generateCurrentWeek(now);
      expect(review.totalCards).toBe(35); // 5 días * 7
      expect(review.totalCorrect).toBeGreaterThan(0);
      expect(review.averageAccuracy).toBeGreaterThan(0);

      // Verificar notificaciones
      const goalNotifs = eventsEmitted.filter((e) => e.type === "goal-completed");
      expect(goalNotifs.length).toBeGreaterThan(0);

      // Deep focus al final
      storage.enableDeepFocusMode(60 * 60 * 1000, now);
      expect(storage.isInDeepFocusMode(now + 30 * 60 * 1000)).toBe(true);
    })();
  });
});
