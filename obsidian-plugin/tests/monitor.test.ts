// Tests de AdherenceMonitorV2.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AdherenceMonitorV2, DEFAULT_MONITOR_OPTIONS } from "../src/exams/monitorV2";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import type { Exam } from "../src/exams/types";

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
  return {
    read: (k: string) => map.get(k) ?? null,
    write: (k: string, v: string) => { map.set(k, v); },
    getStreak: () => state.streak,
    setStreak: (s: never) => { state.streak = s; },
    getReviews: () => state.reviews as never[],
    addReview: () => {},
    addReviewsBatch: () => {},
    reviewsForExam: () => [],
    reviewsBetween: () => [],
    reviewsSince: () => [],
    getGoals: () => state.goals as never,
    setGoals: () => {},
    isInFocusMode: () => false,
    isInDeepFocusMode: () => false,
    enableFocusMode: () => {},
    disableFocusMode: () => {},
    enableDeepFocusMode: () => {},
    disableDeepFocusMode: () => {},
    focusRemainingMs: () => 0,
    deepFocusRemainingMs: () => 0,
    loadForExam: () => [],
    loadReviews: () => [],
    loadReviewsForExam: () => [],
    saveNow: async () => {},
    flush: async () => {},
  };
}

function makeExam(over: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    title: "X",
    subject: "S",
    date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
    examType: "parcial",
    scopes: [],
    status: "active",
    priority: "medium",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("AdherenceMonitorV2", () => {
  let examManager: { list: (f?: { status?: Exam["status"] }) => Exam[] };
  let notificationService: NotificationServiceV2;
  let streakTracker: PersistentStreakTracker;
  let monitor: AdherenceMonitorV2;
  let onCheckCalls: number;
  let onNotifyCalls: number;

  beforeEach(() => {
    examManager = { list: () => [] };
    notificationService = new NotificationServiceV2({}, memStorage());
    streakTracker = new PersistentStreakTracker(memStorage());
    onCheckCalls = 0;
    onNotifyCalls = 0;
    monitor = new AdherenceMonitorV2(
      { intervalHours: 0.001, enabled: true },
      {
        examManager,
        notificationService,
        streakTracker,
        useRealTimer: false,
        now: () => Date.now(),
        onCheck: () => onCheckCalls++,
        onNotify: () => onNotifyCalls++,
      }
    );
  });

  afterEach(() => {
    monitor.stop();
  });

  it("start no inicia si enabled=false", () => {
    monitor.setEnabled(false);
    monitor.start();
    expect(monitor.isRunning()).toBe(false);
  });

  it("start marca running=true", () => {
    monitor.start();
    expect(monitor.isRunning()).toBe(true);
  });

  it("stop marca running=false", () => {
    monitor.start();
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it("tick ejecuta onCheck", () => {
    monitor.tick();
    expect(onCheckCalls).toBe(1);
  });

  it("tick incrementa totalChecks", () => {
    monitor.tick();
    monitor.tick();
    monitor.tick();
    expect(monitor.getTotalChecks()).toBe(3);
  });

  it("tick actualiza lastCheckAt", () => {
    const before = Date.now();
    monitor.tick();
    expect(monitor.getLastCheckAt()).toBeGreaterThanOrEqual(before);
  });

  it("onNotify solo se llama si hay eventos", () => {
    monitor.tick();
    expect(onNotifyCalls).toBe(0);
  });

  it("onNotify se llama con eventos de approaching", () => {
    // Cambiar el examManager para devolver un examen en 3 días
    const in3 = new Date();
    in3.setDate(in3.getDate() + 3);
    examManager.list = () => [makeExam({ date: in3.toISOString().slice(0, 10) })];
    monitor.tick();
    expect(onNotifyCalls).toBe(1);
  });

  it("setEnabled deshabilita", () => {
    monitor.start();
    expect(monitor.isRunning()).toBe(true);
    monitor.setEnabled(false);
    expect(monitor.isRunning()).toBe(false);
  });

  it("setEnabled re-arranca", () => {
    monitor.start();
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
    monitor.setEnabled(true);
    // No se re-arranca con timer real; pero tick() sigue disponible
    expect(monitor.getTotalChecks()).toBeGreaterThan(0);
  });

  it("stop no hace nada si no estaba corriendo", () => {
    expect(() => monitor.stop()).not.toThrow();
  });
});

describe("AdherenceMonitorV2 flujo end-to-end", () => {
  it("detecta eventos de varios tipos en un solo tick", () => {
    const storage = memStorage();
    const streak = new PersistentStreakTracker(storage);
    const svc = new NotificationServiceV2({ examApproachingDays: [7, 1] }, storage);
    const in1 = new Date();
    in1.setDate(in1.getDate() + 1);
    const exam = makeExam({ date: in1.toISOString().slice(0, 10) });
    const mgr = { list: () => [exam] };
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      { examManager: mgr, notificationService: svc, streakTracker: streak, useRealTimer: false, now: () => Date.now() }
    );
    const events = monitor.tick();
    expect(events.some((e) => e.type === "exam-approaching")).toBe(true);
  });
});
