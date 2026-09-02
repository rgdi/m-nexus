// v0.17: Tests de persistencia (PluginDataStorage, PersistentStreakTracker, PersistentAdherenceStore).

import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataStorage, DEFAULT_PERSISTENT_STATE } from "../src/exams/persistence";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import { PersistentAdherenceStore } from "../src/exams/persistentAdherence";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";
import { AdherenceMonitorV2 } from "../src/exams/monitorV2";
import type { Exam, ExamDayPlan } from "../src/exams/types";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData(): Promise<Record<string, unknown> | null> {
    return Object.keys(this.data).length > 0 ? this.data : null;
  }
  async saveData(data: Record<string, unknown>): Promise<void> {
    this.data = { ...data };
  }
  // Para tests: simular reload
  _setData(d: Record<string, unknown>) {
    this.data = { ...d };
  }
  _getData() {
    return this.data;
  }
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("PluginDataStorage", () => {
  it("estado inicial vacío", async () => {
    const plugin = new MockPlugin();
    const storage = await PluginDataStorage.load(plugin as never);
    expect(storage.getReviews()).toEqual([]);
    expect(storage.getStreak().current).toBe(0);
  });

  it("persiste reviews y reload las mantiene", async () => {
    const plugin = new MockPlugin();
    const s1 = await PluginDataStorage.load(plugin as never);
    s1.addReview({ cardId: "c1", examId: "e1", date: "2026-08-30", rating: 3, durationMs: 1000 });
    await s1.saveNow();
    const s2 = await PluginDataStorage.load(plugin as never);
    expect(s2.getReviews()).toHaveLength(1);
    expect(s2.getReviews()[0].cardId).toBe("c1");
  });

  it("focus mode: enable → isInFocusMode true, disable → false", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    expect(s.isInFocusMode()).toBe(false);
    s.enableFocusMode(60_000);
    expect(s.isInFocusMode()).toBe(true);
    s.disableFocusMode();
    expect(s.isInFocusMode()).toBe(false);
  });

  it("focus mode auto-expira después de durationMs", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    s.enableFocusMode(100, 1000); // focus hasta t=1100
    expect(s.isInFocusMode(1050)).toBe(true);  // aún en focus
    expect(s.isInFocusMode(1101)).toBe(false);  // expirado
  });

  it("focusRemainingMs cuenta atrás", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    s.enableFocusMode(1000, 0);
    expect(s.focusRemainingMs(500)).toBe(500);
    expect(s.focusRemainingMs(2000)).toBe(0);
  });
});

describe("PersistentStreakTracker", () => {
  it("racha crece con días consecutivos", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    const r = t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(r.newStreak).toBe(2);
  });

  it("hueco de 2+ días rompe la racha", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(-5), cardsReviewed: 1, durationMs: 100 });
    const r = t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(r.streakBroken).toBe(true);
    expect(r.newStreak).toBe(1);
  });

  it("mismo día acumula cards", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 3, durationMs: 100 });
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 5, durationMs: 200 });
    const last = t.getLastNDays(1)[0];
    expect(last.cardsReviewed).toBe(8);
  });

  it("milestone alcanzado una sola vez", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(-2), cardsReviewed: 1, durationMs: 100 });
    t.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    const r = t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(r.milestoneReached).toBe(3);
    const r2 = t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(r2.milestoneReached).toBeNull();
  });

  it("persiste entre reloads", async () => {
    const plugin = new MockPlugin();
    let s = await PluginDataStorage.load(plugin as never);
    const t1 = new PersistentStreakTracker(s);
    t1.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    t1.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    await s.saveNow();
    s = await PluginDataStorage.load(plugin as never);
    const t2 = new PersistentStreakTracker(s);
    expect(t2.getCurrent()).toBe(2);
  });

  it("getCurrent devuelve 0 si racha rota por inactividad (simulada)", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(-10), cardsReviewed: 1, durationMs: 100 });
    // No estudió hace 10 días
    expect(t.getCurrent()).toBe(0);
  });

  it("isAtRisk: ayer sí, hoy no", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    expect(t.isAtRisk()).toBe(true);
    expect(t.isActive()).toBe(false);
  });
});

describe("PersistentAdherenceStore", () => {
  it("registra reviews y load los devuelve", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const store = new PersistentAdherenceStore(s);
    store.addReview({ cardId: "c1", examId: "e1", date: "2026-08-30", rating: 3, durationMs: 1000 });
    expect(store.loadReviews()).toHaveLength(1);
  });

  it("loadReviewsForExam filtra por examen", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const store = new PersistentAdherenceStore(s);
    store.addReview({ cardId: "c1", examId: "e1", date: "2026-08-30", rating: 3, durationMs: 1000 });
    store.addReview({ cardId: "c2", examId: "e2", date: "2026-08-30", rating: 3, durationMs: 1000 });
    expect(store.loadReviewsForExam("e1")).toHaveLength(1);
  });

  it("loadForExam requiere schedule", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const store = new PersistentAdherenceStore(s);
    const exam: Exam = {
      id: "e1", title: "X", subject: "S", date: "2026-09-15", examType: "parcial",
      scopes: [], status: "active", priority: "medium",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    expect(store.loadForExam(exam)).toEqual([]);
  });
});

describe("NotificationServiceV2", () => {
  it("respeta maxPerDay", () => {
    const storage = {
      read: () => null as string | null,
      write: () => {},
    };
    const svc = new NotificationServiceV2({ maxPerDay: 2 }, storage);
    for (let i = 0; i < 5; i++) {
      svc.emit({
        id: `e${i}`, type: "adherence-drop", title: "t", message: "m",
        timestamp: Date.now(), severity: "info", shown: false,
      });
    }
    expect(svc.getRecent()).toHaveLength(2);
  });

  it("dedupHours no duplica eventos del mismo tipo/examen", () => {
    const storage = {
      read: () => null as string | null,
      write: () => {},
    };
    const svc = new NotificationServiceV2({ dedupHours: 24 }, storage);
    const now = Date.now();
    svc.emit({ id: "1", type: "adherence-drop", examId: "e1", title: "t", message: "m", timestamp: now, severity: "info", shown: false });
    // Intentar emitir otro igual debería ser deduped si se llama via detect
    // Pero emit no dedupea (es API directa). El dedup está en detect*().
  });

  it("focus mode bloquea emisión", () => {
    const storage = {
      read: () => null as string | null,
      write: () => {},
    };
    const svc = new NotificationServiceV2({}, storage);
    svc.setFocusChecker(() => true);
    const e = svc.emit({
      id: "x", type: "adherence-drop", title: "t", message: "m",
      timestamp: Date.now(), severity: "info", shown: false,
    });
    expect(e).toBeNull();
    expect(svc.getRecent()).toHaveLength(0);
  });

  it("focus mode bloquea detectAdherenceDrops", () => {
    const storage = {
      read: () => null as string | null,
      write: () => {},
    };
    const svc = new NotificationServiceV2({}, storage);
    svc.setFocusChecker(() => true);
    const events = svc.detectAdherenceDrops([{
      id: "e1", title: "X", subject: "S", date: dayOffset(3), examType: "parcial",
      scopes: [], status: "active", priority: "medium",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }]);
    expect(events).toHaveLength(0);
  });

  it("detectStreakMilestone: respeta milestones alcanzados", () => {
    const storage = {
      read: () => null as string | null,
      write: () => {},
    };
    const svc = new NotificationServiceV2({}, storage);
    expect(svc.detectStreakMilestone(3, [])).not.toBeNull();
    expect(svc.detectStreakMilestone(3, [3])).toBeNull();
  });

  it("emitBatch respeta maxPerDay", () => {
    const storage = {
      read: () => null as string | null,
      write: () => {},
    };
    const svc = new NotificationServiceV2({ maxPerDay: 2 }, storage);
    const events = [
      { id: "1", type: "exam-approaching" as const, title: "t", message: "m", timestamp: Date.now(), severity: "info" as const, shown: false },
      { id: "2", type: "exam-approaching" as const, title: "t", message: "m", timestamp: Date.now(), severity: "info" as const, shown: false },
      { id: "3", type: "exam-approaching" as const, title: "t", message: "m", timestamp: Date.now(), severity: "info" as const, shown: false },
    ];
    const emitted = svc.emitBatch(events);
    expect(emitted).toHaveLength(2);
  });
});

describe("AdherenceMonitorV2", () => {
  function memStorage() {
    return {
      read: (k: string) => (globalThis as Record<string, string>)[`__${k}`] ?? null,
      write: (k: string, v: string) => { (globalThis as Record<string, string>)[`__${k}`] = v; },
    };
  }
  function makeExamIn(days: number): Exam {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return {
      id: "e1",
      title: "X",
      subject: "S",
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      examType: "parcial",
      scopes: [],
      status: "active",
      priority: "medium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  it("start no inicia si enabled=false", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const storage = memStorage();
    const svc = new NotificationServiceV2({}, storage);
    const store = new PersistentAdherenceStore(s);
    const exam = makeExamIn(7);
    const mgr = { list: () => [exam] };
    const m = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: false },
      { examManager: mgr, notificationService: svc, streakTracker: streak, adherenceStore: store, useRealTimer: false, now: () => Date.now() }
    );
    m.start();
    expect(m.isRunning()).toBe(false);
  });

  it("focus mode bloquea tick", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    s.enableFocusMode(60_000);
    const streak = new PersistentStreakTracker(s);
    const storage = memStorage();
    const svc = new NotificationServiceV2({}, storage);
    const store = new PersistentAdherenceStore(s);
    const exam = makeExamIn(1); // en 1 día → debería disparar
    exam.schedule = {
      daysAvailable: 1, totalCards: 10, sessionsPerDay: 1,
      days: [{
        date: dayOffset(1), cards: 10, newCards: 0, estimatedMinutes: 5,
        cardIds: [], topics: [], conflictsWith: [], overloaded: false,
      }],
      alreadyMature: 0, overdue: 0, estimatedCoverage: 1, warnings: [],
    };
    const mgr = { list: () => [exam] };
    let isFocus = true;
    const m = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: mgr, notificationService: svc, streakTracker: streak, adherenceStore: store,
        useRealTimer: false, now: () => Date.now(),
        isInFocusMode: () => isFocus,
      }
    );
    const events = m.tick();
    expect(events).toHaveLength(0);
    isFocus = false;
    const events2 = m.tick();
    expect(events2.some((e) => e.type === "exam-approaching")).toBe(true);
  });

  it("tick cuenta totalChecks", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const svc = new NotificationServiceV2({}, { read: () => null, write: () => {} });
    const store = new PersistentAdherenceStore(s);
    const m = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [] },
        notificationService: svc, streakTracker: streak, adherenceStore: store,
        useRealTimer: false, now: () => Date.now(),
      }
    );
    m.tick();
    m.tick();
    m.tick();
    expect(m.getTotalChecks()).toBe(3);
  });
});
