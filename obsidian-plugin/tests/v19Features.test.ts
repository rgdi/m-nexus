// v0.19: Tests de las nuevas features.
// 1. Thresholds configurables (clock skew, safe flush)
// 2. Study goals con progress bar
// 3. Deep focus mode (silencia monitor + notificaciones)

import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataStorage } from "../src/exams/persistence";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import { StudyGoals, goalProgress, goalColor, goalLabel, DEFAULT_GOAL_CONFIG } from "../src/exams/studyGoals";
import { AdherenceMonitorV2 } from "../src/exams/monitorV2";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";
import { PersistentAdherenceStore } from "../src/exams/persistentAdherence";
import { SafeFlush } from "../src/exams/safeFlush";
import type { Exam } from "../src/exams/types";
import type { ReviewEvent } from "../src/exams/persistence";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData() { return Object.keys(this.data).length > 0 ? this.data : null; }
  async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
  _getData() { return this.data; }
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── 1. Thresholds configurables ──────────────────────

describe("Thresholds configurables", () => {
  it("clock skew threshold configurable: 1h vs 4h", async () => {
    const plugin = new MockPlugin();
    const s1 = await PluginDataStorage.load(plugin as never);
    // Threshold 1h: gap de 2h = skew
    const t1 = new PersistentStreakTracker(s1, undefined, 3_600_000);
    t1.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 });
    t1.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 + 2 * 3600 * 1000 });
    expect(t1.hasClockSkew()).toBe(true);

    // Threshold 4h: gap de 2h = NO skew
    const s2 = await PluginDataStorage.load(plugin as never);
    const t2 = new PersistentStreakTracker(s2, undefined, 4 * 3_600_000);
    t2.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 });
    t2.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 + 2 * 3600 * 1000 });
    expect(t2.hasClockSkew()).toBe(false);
  });

  it("SafeFlush setOptions cambia retries", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const sf = new SafeFlush(s, { showNotice: false, maxRetries: 5 });
    expect(sf.getOptions().maxRetries).toBe(5);
    sf.setOptions({ maxRetries: 10 });
    expect(sf.getOptions().maxRetries).toBe(10);
  });

  it("SafeFlush backoff configurable", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const sf = new SafeFlush(s, {
      showNotice: false,
      initialDelay: 50,
      backoffFactor: 3,
    });
    expect(sf.getOptions().backoffFactor).toBe(3);
  });
});

// ─── 2. Study goals ──────────────────────────────────

describe("StudyGoals", () => {
  it("createGoal: daily", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 30 });
    const goals = g.syncGoals();
    const daily = goals.find((x) => x.type === "daily-cards");
    expect(daily).toBeDefined();
    expect(daily?.target).toBe(30);
    expect(daily?.current).toBe(0);
    expect(daily?.status).toBe("pending");
  });

  it("createGoal: weekly", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.syncGoals();
    const goals = g.getAll();
    const weekly = goals.find((x) => x.type === "weekly-cards");
    expect(weekly).toBeDefined();
    expect(weekly?.target).toBe(200);
  });

  it("recomputeProgress: daily cards", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 10 });
    g.syncGoals();
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 7; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    g.recomputeProgress(reviews, 1);
    const daily = g.getAll().find((x) => x.type === "daily-cards");
    expect(daily?.current).toBe(7);
    expect(daily?.status).toBe("in-progress");
  });

  it("recomputeProgress: completed goal", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 5 });
    g.syncGoals();
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 6; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    g.recomputeProgress(reviews, 1);
    const daily = g.getAll().find((x) => x.type === "daily-cards");
    expect(daily?.current).toBe(6);
    expect(daily?.status).toBe("completed");
  });

  it("recomputeProgress: streak", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ streakDays: 3 });
    g.syncGoals();
    g.recomputeProgress([], 3);
    const streak = g.getAll().find((x) => x.type === "streak-days");
    expect(streak?.current).toBe(3);
    expect(streak?.status).toBe("completed");
  });

  it("recomputeProgress: accuracy", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ accuracyRate: 0.8 });
    g.syncGoals();
    const reviews: ReviewEvent[] = [
      { cardId: "c1", examId: "e1", date: dayOffset(0), rating: 4, durationMs: 1000 },
      { cardId: "c2", examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 },
      { cardId: "c3", examId: "e1", date: dayOffset(0), rating: 2, durationMs: 1000 },
      { cardId: "c4", examId: "e1", date: dayOffset(0), rating: 1, durationMs: 1000 },
    ];
    g.recomputeProgress(reviews, 1);
    const acc = g.getAll().find((x) => x.type === "accuracy");
    expect(acc?.current).toBe(0.5); // 2/4
    expect(acc?.status).toBe("in-progress");
  });

  it("resetGoal", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 5 });
    g.syncGoals();
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 6; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    g.recomputeProgress(reviews, 1);
    const daily = g.getAll().find((x) => x.type === "daily-cards");
    expect(daily?.status).toBe("completed");
    g.resetGoal(daily!.id);
    const after = g.getAll().find((x) => x.id === daily!.id);
    expect(after?.current).toBe(0);
    expect(after?.status).toBe("pending");
  });

  it("config persiste entre reloads", async () => {
    const plugin = new MockPlugin();
    let s = await PluginDataStorage.load(plugin as never);
    const g1 = new StudyGoals(s);
    g1.setConfig({ dailyCards: 50, weeklyCards: 300 });
    await s.saveNow();
    s = await PluginDataStorage.load(plugin as never);
    const g2 = new StudyGoals(s);
    expect(g2.getConfig().dailyCards).toBe(50);
    expect(g2.getConfig().weeklyCards).toBe(300);
  });

  it("goalProgress calcula 0..1", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 10 });
    g.syncGoals();
    const reviews: ReviewEvent[] = [];
    for (let i = 0; i < 5; i++) {
      reviews.push({ cardId: `c${i}`, examId: "e1", date: dayOffset(0), rating: 3, durationMs: 1000 });
    }
    g.recomputeProgress(reviews, 1);
    const daily = g.getAll().find((x) => x.type === "daily-cards")!;
    expect(goalProgress(daily)).toBe(0.5);
  });

  it("goalProgress clamp a 1", async () => {
    const goal = { id: "x", type: "daily-cards" as const, target: 5, current: 10, periodStart: "", periodEnd: "", status: "completed" as const, updatedAt: 0 };
    expect(goalProgress(goal)).toBe(1);
  });

  it("goalColor: completed = green", () => {
    const goal = { id: "x", type: "daily-cards" as const, target: 5, current: 5, periodStart: "", periodEnd: "", status: "completed" as const, updatedAt: 0 };
    expect(goalColor(goal)).toBe("green");
  });

  it("goalColor: expired = red", () => {
    const goal = { id: "x", type: "daily-cards" as const, target: 5, current: 2, periodStart: "", periodEnd: "", status: "expired" as const, updatedAt: 0 };
    expect(goalColor(goal)).toBe("red");
  });

  it("goalLabel: formatea con iconos", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 30 });
    g.syncGoals();
    const daily = g.getAll().find((x) => x.type === "daily-cards")!;
    expect(goalLabel(daily)).toContain("Diario");
    expect(goalLabel(daily)).toContain("0/30");
  });

  it("expired goals: no se actualizan pero quedan en historial", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const g = new StudyGoals(s);
    g.setConfig({ dailyCards: 5 });
    g.syncGoals();
    // El daily goal tiene periodEnd = today. Forzamos periodEnd a ayer.
    const state = s.getGoals();
    const daily = state.goals.find((x) => x.type === "daily-cards")!;
    daily.periodEnd = dayOffset(-1);
    s.setGoals(state);
    // Re-sincronizar. El goal "diario" debería expirarse.
    g.syncGoals();
    // El goal expirado está en historial
    const history = g.getCompleted();
    expect(history.some((h) => h.id === daily.id)).toBe(true);
    // Y no aparece en goals activos
    const active = g.getActiveGoals();
    expect(active.find((x) => x.id === daily.id)).toBeUndefined();
  });

  it("setOptions en safeFlush", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const sf = new SafeFlush(s, { maxRetries: 3 });
    sf.setOptions({ maxRetries: 5, backoffFactor: 1.5 });
    expect(sf.getOptions().maxRetries).toBe(5);
    expect(sf.getOptions().backoffFactor).toBe(1.5);
  });
});

// ─── 3. Deep focus mode ──────────────────────────────

describe("Deep focus mode", () => {
  function makeExam(): Exam {
    return {
      id: "e1", title: "X", subject: "S", date: dayOffset(1),
      examType: "parcial", scopes: [], status: "active", priority: "medium",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }

  it("deep focus: skipea tick completamente", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1], dedupHours: 0 },
      { read: () => null, write: () => {} }
    );
    const store = new PersistentAdherenceStore(s);
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [makeExam()] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInDeepFocusMode: () => true,
      }
    );
    expect(monitor.tick()).toEqual([]);
    expect(monitor.getTotalSkippedByDeepFocus()).toBe(1);
  });

  it("deep focus tiene prioridad sobre focus normal", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2({}, { read: () => null, write: () => {} });
    const store = new PersistentAdherenceStore(s);
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInFocusMode: () => false,
        isInDeepFocusMode: () => true, // deep focus gana
      }
    );
    monitor.tick();
    expect(monitor.getTotalSkippedByDeepFocus()).toBe(1);
    expect(monitor.getTotalSkippedByFocus()).toBe(0);
  });

  it("deep focus off: tick corre normal", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1], dedupHours: 0 },
      { read: () => null, write: () => {} }
    );
    const store = new PersistentAdherenceStore(s);
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [makeExam()] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInDeepFocusMode: () => false,
      }
    );
    const events = monitor.tick();
    expect(events.length).toBeGreaterThan(0);
  });

  it("deep focus: no se ejecuta ningún detector", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1], dedupHours: 0 },
      { read: () => null, write: () => {} }
    );
    let detectCalled = false;
    const origDetect = notif.detectExamApproaching.bind(notif);
    notif.detectExamApproaching = (exams) => {
      detectCalled = true;
      return origDetect(exams);
    };
    const store = new PersistentAdherenceStore(s);
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [makeExam()] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInDeepFocusMode: () => true,
      }
    );
    monitor.tick();
    expect(detectCalled).toBe(false);
  });

  it("deepFocusStopsMonitor: false deshabilita el bloqueo", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1], dedupHours: 0 },
      { read: () => null, write: () => {} }
    );
    const store = new PersistentAdherenceStore(s);
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [makeExam()] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInDeepFocusMode: () => true,
        deepFocusStopsMonitor: false, // ← desactivado
      }
    );
    const events = monitor.tick();
    expect(events.length).toBeGreaterThan(0); // tick corre
  });

  it("PluginDataStorage: enableDeepFocusMode + isInDeepFocusMode", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    expect(s.isInDeepFocusMode()).toBe(false);
    s.enableDeepFocusMode(60_000, 1000);
    expect(s.isInDeepFocusMode(1010)).toBe(true);
    expect(s.isInDeepFocusMode(70_000)).toBe(false); // expirado
  });

  it("PluginDataStorage: deepFocusRemainingMs", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    s.enableDeepFocusMode(1000, 1000);
    expect(s.deepFocusRemainingMs(1500)).toBe(500);
    expect(s.deepFocusRemainingMs(3000)).toBe(0);
  });
});
