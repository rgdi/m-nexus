// v0.21: Tests migrados de v0.16 a V2.
// StreakTracker (v0.16) → PersistentStreakTracker
// NotificationService (v0.16) → NotificationServiceV2

import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataStorage } from "../src/exams/persistence";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData() { return Object.keys(this.data).length > 0 ? this.data : null; }
  async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
}

function memStorage() {
  const map = new Map<string, string>();
  return {
    read: (k: string) => map.get(k) ?? null,
    write: (k: string, v: string) => { map.set(k, v); },
  };
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("Streak (V2) — equivalente a v0.16 tests", () => {
  let storage: PluginDataStorage;
  let tracker: PersistentStreakTracker;

  beforeEach(async () => {
    storage = await PluginDataStorage.load(new MockPlugin() as never);
    tracker = new PersistentStreakTracker(storage);
  });

  it("estado inicial vacío", () => {
    expect(tracker.getCurrent()).toBe(0);
    expect(tracker.getBest()).toBe(0);
    expect(tracker.getLastStudyDate()).toBeNull();
  });

  it("primer estudio → current=1", () => {
    const r = tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 5, durationMs: 1000 });
    expect(r.newStreak).toBe(1);
  });

  it("dos días consecutivos → current=2", () => {
    tracker.recordStudy({ date: dayOffset(-1), cardsReviewed: 5, durationMs: 1000 });
    const r = tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 5, durationMs: 1000 });
    expect(r.newStreak).toBe(2);
  });

  it("hueco de 2+ días rompe la racha", () => {
    tracker.recordStudy({ date: dayOffset(-5), cardsReviewed: 5, durationMs: 1000 });
    const r = tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 5, durationMs: 1000 });
    expect(r.streakBroken).toBe(true);
    expect(r.newStreak).toBe(1);
  });

  it("best se actualiza cuando current > best", () => {
    tracker.recordStudy({ date: dayOffset(-3), cardsReviewed: 1, durationMs: 100 });
    tracker.recordStudy({ date: dayOffset(-2), cardsReviewed: 1, durationMs: 100 });
    tracker.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    const r = tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(r.isNewRecord).toBe(true);
    expect(tracker.getBest()).toBe(4);
  });

  it("mismo día acumula cards", () => {
    tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 3, durationMs: 100 });
    tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 5, durationMs: 200 });
    const last = tracker.getLastNDays(1)[0];
    expect(last.cardsReviewed).toBe(8);
  });

  it("milestone al alcanzar 3 días", () => {
    tracker.recordStudy({ date: dayOffset(-2), cardsReviewed: 1, durationMs: 100 });
    tracker.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    const r = tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(r.milestoneReached).toBe(3);
  });

  it("isActive: true si estudió hoy", () => {
    tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(tracker.isActive()).toBe(true);
  });

  it("isAtRisk: true si estudió ayer pero no hoy", () => {
    tracker.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    expect(tracker.isAtRisk()).toBe(true);
    expect(tracker.isActive()).toBe(false);
  });

  it("daysToNextMilestone", () => {
    const t = new PersistentStreakTracker(storage, [3, 7]);
    t.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100 });
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100 });
    expect(t.daysToNextMilestone()).toBe(1);
  });

  it("getTotalCards y getTotalDurationMs", () => {
    tracker.recordStudy({ date: dayOffset(-1), cardsReviewed: 5, durationMs: 1000 });
    tracker.recordStudy({ date: dayOffset(0), cardsReviewed: 3, durationMs: 500 });
    expect(tracker.getTotalCards()).toBe(8);
    expect(tracker.getTotalDurationMs()).toBe(1500);
  });

  it("persistencia: load desde storage", async () => {
    const t1 = new PersistentStreakTracker(storage);
    t1.recordStudy({ date: dayOffset(-1), cardsReviewed: 5, durationMs: 1000 });
    await storage.saveNow();
    const t2 = new PersistentStreakTracker(storage);
    expect(t2.getCurrent()).toBeGreaterThan(0);
  });
});

describe("Notifications (V2) — equivalente a v0.16 tests", () => {
  it("emite un evento y lo persiste", () => {
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, memStorage());
    const e = svc.emit({
      id: "x", type: "adherence-drop", title: "T", message: "M",
      timestamp: Date.now(), severity: "warning", shown: false,
    });
    expect(e).not.toBeNull();
    expect(svc.getRecent()).toHaveLength(1);
  });

  it("getUnshown filtra por shown", () => {
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, memStorage());
    svc.emit({ id: "1", type: "adherence-drop", title: "A", message: "M", timestamp: Date.now(), severity: "info", shown: false });
    svc.emit({ id: "2", type: "adherence-drop", title: "B", message: "M", timestamp: Date.now(), severity: "info", shown: false });
    expect(svc.getUnshown()).toHaveLength(2);
    svc.markShown(["1"]);
    expect(svc.getUnshown()).toHaveLength(1);
  });

  it("prune elimina eventos > 30 días", () => {
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, memStorage());
    const oldTs = Date.now() - 31 * 24 * 3600 * 1000;
    const freshTs = Date.now();
    svc.emit({ id: "old", type: "adherence-drop", title: "x", message: "m", timestamp: oldTs, severity: "info", shown: true });
    svc.emit({ id: "new", type: "adherence-drop", title: "x", message: "m", timestamp: freshTs, severity: "info", shown: false });
    svc.prune();
    expect(svc.getRecent().map((e) => e.id)).toEqual(["new"]);
  });

  it("detectExamApproaching: respeta days en lista", () => {
    const svc = new NotificationServiceV2(
      { examApproachingDays: [7, 3, 1], maxPerDay: 10, dedupHours: 0 },
      memStorage()
    );
    const exam = {
      id: "A", title: "A", subject: "S", date: dayOffset(3), examType: "final" as const,
      scopes: [], status: "active" as const, priority: "medium" as const,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const events = svc.detectExamApproaching([exam]);
    expect(events.length).toBe(1);
  });

  it("detectStreakMilestone: respeta milestones alcanzados", () => {
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, memStorage());
    expect(svc.detectStreakMilestone(3, [])).not.toBeNull();
    expect(svc.detectStreakMilestone(3, [3])).toBeNull();
  });

  it("emitBatch respeta maxPerDay", () => {
    const svc = new NotificationServiceV2({ maxPerDay: 2 }, memStorage());
    const events = [
      { id: "1", type: "exam-approaching" as const, title: "t", message: "m", timestamp: Date.now(), severity: "info" as const, shown: false },
      { id: "2", type: "exam-approaching" as const, title: "t", message: "m", timestamp: Date.now(), severity: "info" as const, shown: false },
      { id: "3", type: "exam-approaching" as const, title: "t", message: "m", timestamp: Date.now(), severity: "info" as const, shown: false },
    ];
    expect(svc.emitBatch(events)).toHaveLength(2);
  });

  it("focus mode bloquea emisión", () => {
    const svc = new NotificationServiceV2({ maxPerDay: 10 }, memStorage());
    svc.setFocusChecker(() => true);
    const e = svc.emit({ id: "x", type: "adherence-drop", title: "t", message: "m", timestamp: Date.now(), severity: "info", shown: false });
    expect(e).toBeNull();
  });
});
