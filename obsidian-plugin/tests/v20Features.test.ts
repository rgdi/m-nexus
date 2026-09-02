// v0.20: Tests de las 3 features nuevas.
// 1. Notificaciones de goals completados
// 2. UI deep focus con countdown (lógica)
// 3. Weekly review automático

import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataStorage } from "../src/exams/persistence";
import { StudyGoals } from "../src/exams/studyGoals";
import { WeeklyReviewService } from "../src/exams/weeklyReview";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";
import type { ReviewEvent } from "../src/exams/persistence";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData() { return Object.keys(this.data).length > 0 ? this.data : null; }
  async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── 1. Notificaciones de goals completados ──────────

describe("Notificaciones de goals completados", () => {
  it("notifica cuando un goal pasa de pending a completed", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, { read: () => null, write: () => {} });
    const goals = new StudyGoals(s, svc);
    // Goal de streak bajo para que solo se complete ese
    goals.setConfig({ dailyCards: 100, streakDays: 1 });
    goals.syncGoals();

    // 1 review del día + streak=1 → completa el goal de streak
    const reviews: ReviewEvent[] = [
      { cardId: "c1", examId: "e1", date: dayOffset(0), rating: 1, durationMs: 1000 },
    ];
    goals.recomputeProgress(reviews, 1);

    const goalNotif = svc.getRecent().find((e) => e.type === "goal-completed");
    expect(goalNotif).toBeDefined();
    expect(goalNotif?.title).toContain("Racha");
  });

  it("no notifica 2 veces el mismo goal (dedup 24h)", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, { read: () => null, write: () => {} });
    const goals = new StudyGoals(s, svc);
    goals.setConfig({ dailyCards: 5 });
    goals.syncGoals();

    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 6; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    goals.recomputeProgress(reviews, 1);
    const before = svc.getRecent().filter((e) => e.type === "goal-completed").length;

    // Re-recompute (no debería notificar de nuevo)
    goals.recomputeProgress(reviews, 1);
    const after = svc.getRecent().filter((e) => e.type === "goal-completed").length;

    expect(after).toBe(before);
  });

  it("notifica goal de accuracy completado", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, { read: () => null, write: () => {} });
    const goals = new StudyGoals(s, svc);
    goals.setConfig({ accuracyRate: 0.7 });
    goals.syncGoals();

    // 10 reviews todas correctas → 100% accuracy
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 10; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 4, durationMs: 1000 });
    }
    goals.recomputeProgress(reviews, 1);

    const goalNotif = svc.getRecent().find((e) => e.type === "goal-completed");
    expect(goalNotif?.title).toContain("accuracy");
  });

  it("setNotificationService reconfigura el service", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const goals = new StudyGoals(s);
    const svc = new NotificationServiceV2({}, { read: () => null, write: () => {} });
    goals.setNotificationService(svc);
    goals.setConfig({ dailyCards: 5 });
    goals.syncGoals();
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 6; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    goals.recomputeProgress(reviews, 1);
    expect(svc.getRecent().some((e) => e.type === "goal-completed")).toBe(true);
  });

  it("sin notificationService: no emite pero funciona", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const goals = new StudyGoals(s); // sin svc
    goals.setConfig({ dailyCards: 5 });
    goals.syncGoals();
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 6; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    // No debe crashear
    expect(() => goals.recomputeProgress(reviews, 1)).not.toThrow();
  });
});

// ─── 2. Weekly review ──────────────────────────────────

describe("Weekly review", () => {
  it("generateCurrentWeek: stats básicos", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    // 10 reviews hoy
    for (let i = 0; i < 10; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 5000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    expect(review.totalCards).toBe(10);
    expect(review.totalCorrect).toBe(10);
    expect(review.averageAccuracy).toBe(1);
  });

  it("accuracy: mezcla de correctas e incorrectas", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    for (let i = 0; i < 8; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    for (let i = 8; i < 10; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 1, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    expect(review.totalCards).toBe(10);
    expect(review.totalCorrect).toBe(8);
    expect(review.averageAccuracy).toBe(0.8);
  });

  it("rating: great si accuracy >= 0.85", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    for (let i = 0; i < 10; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 4, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    expect(review.rating).toBe("great");
  });

  it("rating: low si accuracy < 0.5", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    // 6 incorrectas + 4 correctas = 40% accuracy
    for (let i = 0; i < 6; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 1, durationMs: 1000 });
    }
    for (let i = 6; i < 10; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    expect(review.averageAccuracy).toBe(0.4);
    expect(review.rating).toBe("low");
  });

  it("bestDay: día con más cards", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    // Forzar "now" a miércoles para que "hace 2 días" siga en la misma semana
    // (miércoles 2026-09-02)
    const now = new Date(2026, 8, 2, 12, 0, 0).getTime(); // 2 sep 2026 (miércoles)
    const today = new Date(now);
    const d1 = new Date(now);
    d1.setDate(d1.getDate() - 1); // martes
    const d2 = new Date(now);
    d2.setDate(d2.getDate() - 2); // lunes
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const d1Str = `${d1.getFullYear()}-${String(d1.getMonth() + 1).padStart(2, "0")}-${String(d1.getDate()).padStart(2, "0")}`;
    const d2Str = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;

    // 5 hoy, 8 ayer (martes), 2 lunes
    for (let i = 0; i < 5; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: todayStr, rating: 3, durationMs: 1000 });
    }
    for (let i = 0; i < 8; i++) {
      s.addReview({ cardId: `d${i}`, examId: "e1", date: d1Str, rating: 3, durationMs: 1000 });
    }
    for (let i = 0; i < 2; i++) {
      s.addReview({ cardId: `e${i}`, examId: "e1", date: d2Str, rating: 3, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek(now);
    expect(review.bestDay?.date).toBe(d1Str);
    expect(review.bestDay?.cards).toBe(8);
  });

  it("snapshot: guardar y recuperar", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    for (let i = 0; i < 5; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    svc.saveSnapshot(review);
    const snapshots = svc.getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].totalCards).toBe(5);
  });

  it("snapshot: update si ya existe para esa semana", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    for (let i = 0; i < 5; i++) {
      s.addReview({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    svc.saveSnapshot(review);
    svc.saveSnapshot(review); // mismo weekStart
    expect(svc.getSnapshots()).toHaveLength(1);
  });

  it("snapshot: cap a 12", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new WeeklyReviewService(s);
    for (let i = 0; i < 15; i++) {
      const fakeSnapshot = {
        weekStart: `2026-0${(i % 9) + 1}-0${(i % 7) + 1}`,
        weekEnd: "2026-01-08",
        totalCards: i,
        totalCorrect: i,
        totalDurationMs: 0,
        averageAccuracy: 1,
        generatedAt: Date.now(),
      };
      svc.saveSnapshot({
        ...fakeSnapshot,
        bestDay: null,
        worstDay: null,
        deltaCards: 0,
        deltaAccuracy: 0,
        rating: "ok" as const,
        days: [],
      });
    }
    expect(svc.getSnapshots().length).toBeLessThanOrEqual(12);
  });

  it("deltaCards: positivo si subimos vs semana anterior", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    // Semana anterior: 5 cards
    for (let i = 0; i < 5; i++) {
      s.addReview({ cardId: `a${i}`, examId: "e1", date: dayOffset(-7), rating: 3, durationMs: 1000 });
    }
    // Semana actual: 10 cards
    for (let i = 0; i < 10; i++) {
      s.addReview({ cardId: `b${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    expect(review.deltaCards).toBe(5);
  });

  it("days: array de 7 elementos", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new WeeklyReviewService(s);
    const review = svc.generateCurrentWeek();
    expect(review.days).toHaveLength(7);
  });
});

// ─── 3. Weekly review notification ────────────────────

describe("Weekly review notification", () => {
  it("notifyWeeklyReviewReady emite evento", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, { read: () => null, write: () => {} });
    const event = svc.notifyWeeklyReviewReady("2026-08-25", "2026-08-31");
    expect(event).not.toBeNull();
    expect(event?.type).toBe("weekly-review-ready");
  });

  it("no duplica weekly review en 7 días", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, { read: () => null, write: () => {} });
    svc.notifyWeeklyReviewReady("2026-08-25", "2026-08-31");
    const e2 = svc.notifyWeeklyReviewReady("2026-08-25", "2026-08-31");
    expect(e2).toBeNull();
  });

  it("focus mode bloquea notifyWeeklyReviewReady", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, { read: () => null, write: () => {} });
    svc.setFocusChecker(() => true);
    const e = svc.notifyWeeklyReviewReady("2026-08-25", "2026-08-31");
    expect(e).toBeNull();
  });
});
