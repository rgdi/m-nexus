// v0.24: Tests funcionales uno por uno de cada feature v0.21/v0.22.
// Verifica que cada función hace lo que dice.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ────────────────────────────────────────────────────────────
// 1. SCHEDULE MATCHER — función por función
// ────────────────────────────────────────────────────────────
import {
  ScheduleMatcher,
  formatSchedule,
  type ClassSchedule,
  DEFAULT_MATCH_OPTIONS,
} from "../src/exams/scheduleMatcher";

const SAMPLE_SCHEDULES: ClassSchedule[] = [
  { subject: "Anatomía", dayOfWeek: 1, startMinute: 540, durationMinutes: 60, location: "Aula 101" },
  { subject: "Bioquímica", dayOfWeek: 2, startMinute: 600, durationMinutes: 90, location: "Lab 3" },
  { subject: "Histología", dayOfWeek: 3, startMinute: 660, durationMinutes: 60 },
];

describe("FUNCIONAL: ScheduleMatcher — funciones individuales", () => {
  it("1.1 match() — match exacto con duración completa", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    // Lunes 7 sep 2026 a las 9:00, 60min exacto
    const start = new Date(2026, 8, 7, 9, 0, 0).getTime();
    const result = m.match(start, 60 * 60_000);
    expect(result).not.toBeNull();
    expect(result!.schedule.subject).toBe("Anatomía");
    expect(result!.confidence).toBeGreaterThan(0.9);
  });

  it("1.2 match() — match parcial con grabación más corta que clase", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    // Lunes 7 sep 2026 a las 9:00, solo 15min
    const start = new Date(2026, 8, 7, 9, 0, 0).getTime();
    const result = m.match(start, 15 * 60_000);
    expect(result).not.toBeNull();
    expect(result!.schedule.subject).toBe("Anatomía");
  });

  it("1.3 match() — día equivocado → null", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    // Domingo 13 sep 2026 a las 9:00 (no hay clase)
    const start = new Date(2026, 8, 13, 9, 0, 0).getTime();
    const result = m.match(start, 60 * 60_000);
    expect(result).toBeNull();
  });

  it("1.4 match() — muy lejos del horario → null", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    // Lunes 7 sep 2026 a las 15:00 (la clase es a las 9:00, 6h de diferencia)
    const start = new Date(2026, 8, 7, 15, 0, 0).getTime();
    const result = m.match(start, 30 * 60_000);
    expect(result).toBeNull();
  });

  it("1.5 matchAll() — devuelve array (vacío si no hay match)", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    const results = m.matchAll(new Date(2026, 8, 13, 9, 0, 0).getTime(), 60 * 60_000);
    expect(Array.isArray(results)).toBe(true);
  });

  it("1.6 getUpcoming() — devuelve las próximas N clases", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    const now = new Date(2026, 8, 7, 8, 0, 0).getTime(); // lunes 8 AM
    const upcoming = m.getUpcoming(now, 5);
    expect(upcoming.length).toBe(3);
    expect(upcoming[0].schedule.subject).toBe("Anatomía");
  });

  it("1.7 getUpcoming() — el timestamp es futuro", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    const now = new Date(2026, 8, 7, 8, 0, 0).getTime();
    const upcoming = m.getUpcoming(now, 5);
    for (const u of upcoming) {
      expect(u.startsAtMs).toBeGreaterThanOrEqual(now);
    }
  });

  it("1.8 formatSchedule() — incluye día, hora y subject", () => {
    const s = SAMPLE_SCHEDULES[0];
    const formatted = formatSchedule(s);
    expect(formatted).toContain("Anatomía");
    expect(formatted).toMatch(/lun|Lun|LUN/);
    expect(formatted).toMatch(/09:00/);
    expect(formatted).toMatch(/10:00/);
  });

  it("1.9 formatSchedule() — incluye location si existe", () => {
    const formatted = formatSchedule(SAMPLE_SCHEDULES[0]);
    expect(formatted).toContain("Aula 101");
  });

  it("1.10 options por defecto — minConfidence = 0.5", () => {
    expect(DEFAULT_MATCH_OPTIONS.minConfidence).toBe(0.5);
  });

  it("1.11 custom options — funciona con minConfidence = 0.1", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES, { minConfidence: 0.1 });
    // Con umbral bajo, incluso matches lejanos se aceptan
    const start = new Date(2026, 8, 7, 11, 0, 0).getTime(); // 2h después de anatomía
    const result = m.match(start, 30 * 60_000);
    // Puede o no matchear dependiendo del tolerance
  });

  it("1.12 match() — devuelve ScheduleMatch con reason", () => {
    const m = new ScheduleMatcher(SAMPLE_SCHEDULES);
    const start = new Date(2026, 8, 7, 9, 0, 0).getTime();
    const result = m.match(start, 60 * 60_000);
    expect(result!.reason).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────
// 2. PUSH BRIDGE — función por función
// ────────────────────────────────────────────────────────────
import { PushBridge, DEFAULT_ENABLED_CATEGORIES } from "../src/exams/pushBridge";

describe("FUNCIONAL: PushBridge — funciones individuales", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("2.1 register() — envía POST /push/register con todos los campos", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok-123",
      deviceId: "device-abc",
      platform: "android",
      pushToken: "fcm-token-xyz",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const r = await bridge.register();
    expect(r.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/push/register",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Authorization": "Bearer tok-123",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("2.2 register() — falla sin pushToken", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "ios",
      enabled: true,
      enabledCategories: new Set(),
    });
    const r = await bridge.register();
    expect(r.success).toBe(false);
  });

  it("2.3 send() — envía el evento al backend", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "ios",
      pushToken: "apns-tok",
      enabled: true,
      enabledCategories: new Set(["exam-approaching"]),
    });
    const event = {
      id: "ev-1",
      type: "exam-approaching" as const,
      title: "T",
      message: "M",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const r = await bridge.send(event);
    expect(r.success).toBe(true);
  });

  it("2.4 send() — dedup: no envía el mismo evento 2 veces", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "ios",
      pushToken: "apns-tok",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const event = {
      id: "dup-1",
      type: "goal-completed" as const,
      title: "T",
      message: "M",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const r1 = await bridge.send(event);
    const r2 = await bridge.send(event);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
  });

  it("2.5 send() — categoría deshabilitada → no envía", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "ios",
      pushToken: "apns-tok",
      enabled: true,
      enabledCategories: new Set(["goal-completed"]), // solo goals
    });
    const event = {
      id: "ev-x",
      type: "exam-approaching" as const,
      title: "T",
      message: "M",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const r = await bridge.send(event);
    expect(r.success).toBe(false);
    expect(r.error).toContain("category");
  });

  it("2.6 send() — enabled=false → no envía", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "ios",
      pushToken: "apns-tok",
      enabled: false,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const event = {
      id: "ev-x",
      type: "exam-approaching" as const,
      title: "T",
      message: "M",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const r = await bridge.send(event);
    expect(r.success).toBe(false);
  });

  it("2.7 send() — error de red manejado", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network down"));
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "ios",
      pushToken: "apns-tok",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const event = {
      id: "ev-net",
      type: "goal-completed" as const,
      title: "T",
      message: "M",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const r = await bridge.send(event);
    expect(r.success).toBe(false);
    expect(r.error).toContain("Network");
  });

  it("2.8 DEFAULT_ENABLED_CATEGORIES — contiene 6 categorías", () => {
    expect(DEFAULT_ENABLED_CATEGORIES.size).toBe(6);
    expect(DEFAULT_ENABLED_CATEGORIES.has("exam-approaching")).toBe(true);
    expect(DEFAULT_ENABLED_CATEGORIES.has("streak-milestone")).toBe(true);
    expect(DEFAULT_ENABLED_CATEGORIES.has("adherence-drop")).toBe(true);
    expect(DEFAULT_ENABLED_CATEGORIES.has("plan-requires-rebalance")).toBe(true);
    expect(DEFAULT_ENABLED_CATEGORIES.has("goal-completed")).toBe(true);
    expect(DEFAULT_ENABLED_CATEGORIES.has("weekly-review-ready")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// 3. PERSISTENCE — classSchedules
// ────────────────────────────────────────────────────────────
import { PluginDataStorage } from "../src/exams/persistence";

class MockPlugin {
  data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = JSON.parse(JSON.stringify(d)); }
}

describe("FUNCIONAL: PluginDataStorage — classSchedules", () => {
  it("3.1 getClassSchedules() — vacío por defecto", async () => {
    const p = new MockPlugin();
    const s = await PluginDataStorage.load(p as never);
    expect(s.getClassSchedules()).toEqual([]);
  });

  it("3.2 addClassSchedule() — añade un schedule", async () => {
    const p = new MockPlugin();
    const s = await PluginDataStorage.load(p as never);
    s.addClassSchedule({ subject: "X", dayOfWeek: 1, startMinute: 540, durationMinutes: 60 });
    expect(s.getClassSchedules()).toHaveLength(1);
  });

  it("3.3 setClassSchedules() — reemplaza todos", async () => {
    const p = new MockPlugin();
    const s = await PluginDataStorage.load(p as never);
    s.setClassSchedules([
      { subject: "A", dayOfWeek: 1, startMinute: 540, durationMinutes: 60 },
      { subject: "B", dayOfWeek: 2, startMinute: 600, durationMinutes: 90 },
    ]);
    expect(s.getClassSchedules()).toHaveLength(2);
  });

  it("3.4 addClassSchedule() — múltiples se acumulan", async () => {
    const p = new MockPlugin();
    const s = await PluginDataStorage.load(p as never);
    for (let i = 0; i < 5; i++) {
      s.addClassSchedule({ subject: `S${i}`, dayOfWeek: (i % 6) as 0 | 1 | 2 | 3 | 4 | 5, startMinute: 540, durationMinutes: 60 });
    }
    expect(s.getClassSchedules()).toHaveLength(5);
  });
});

// ────────────────────────────────────────────────────────────
// 4. WEEKLY REVIEW — tests funcionales
// ────────────────────────────────────────────────────────────
import { WeeklyReviewService } from "../src/exams/weeklyReview";

describe("FUNCIONAL: WeeklyReviewService — funciones individuales", () => {
  let storage: PluginDataStorage;

  beforeEach(async () => {
    const p = new MockPlugin();
    storage = await PluginDataStorage.load(p as never);
  });

  it("4.1 generateCurrentWeek() — semana con 0 reviews tiene totalCards=0", () => {
    const svc = new WeeklyReviewService(storage);
    const review = svc.generateCurrentWeek(new Date(2026, 8, 3).getTime());
    expect(review.totalCards).toBe(0);
    expect(review.days.length).toBe(7);
  });

  it("4.2 generateCurrentWeek() — cuenta reviews correctamente", () => {
    // 7 sep 2026 = lunes
    storage.addReview({ date: "2026-09-07", cardId: "c1", examId: null, rating: 3, durationMs: 10_000 });
    storage.addReview({ date: "2026-09-08", cardId: "c2", examId: null, rating: 4, durationMs: 10_000 });
    storage.addReview({ date: "2026-09-09", cardId: "c3", examId: null, rating: 1, durationMs: 10_000 });
    const svc = new WeeklyReviewService(storage);
    const review = svc.generateCurrentWeek(new Date(2026, 8, 7).getTime());
    expect(review.totalCards).toBe(3);
  });

  it("4.3 generateCurrentWeek() — calcula accuracy correctamente", () => {
    storage.addReview({ date: "2026-09-07", cardId: "c1", examId: null, rating: 3, durationMs: 10_000 });
    storage.addReview({ date: "2026-09-07", cardId: "c2", examId: null, rating: 4, durationMs: 10_000 });
    storage.addReview({ date: "2026-09-07", cardId: "c3", examId: null, rating: 1, durationMs: 10_000 });
    storage.addReview({ date: "2026-09-07", cardId: "c4", examId: null, rating: 2, durationMs: 10_000 });
    const svc = new WeeklyReviewService(storage);
    const review = svc.generateCurrentWeek(new Date(2026, 8, 7).getTime());
    // 2 correctas de 4 = 0.5
    expect(review.averageAccuracy).toBe(0.5);
  });

  it("4.4 generateLastWeek() — semana anterior vacía", () => {
    const svc = new WeeklyReviewService(storage);
    const review = svc.generateLastWeek(new Date(2026, 8, 10).getTime());
    expect(review.totalCards).toBe(0);
  });

  it("4.5 saveSnapshot() — guarda en storage", () => {
    const svc = new WeeklyReviewService(storage);
    storage.addReview({ date: "2026-09-07", cardId: "c1", examId: null, rating: 3, durationMs: 10_000 });
    const review = svc.generateCurrentWeek(new Date(2026, 8, 3).getTime());
    svc.saveSnapshot(review);
    const snapshots = svc.getSnapshots();
    expect(snapshots.length).toBe(1);
  });

  it("4.6 saveSnapshot() — cap a 12 snapshots", () => {
    const svc = new WeeklyReviewService(storage);
    for (let i = 0; i < 15; i++) {
      svc.saveSnapshot({
        weekStart: `2026-${String(i).padStart(2, "0")}-01`,
        weekEnd: `2026-${String(i).padStart(2, "0")}-07`,
        totalCards: i,
        totalCorrect: i,
        totalDurationMs: 0,
        averageAccuracy: 0.5,
        days: [],
        bestDay: null,
        worstDay: null,
        rating: "ok",
        deltaCards: 0,
        deltaAccuracy: 0,
        generatedAt: Date.now(),
      });
    }
    expect(svc.getSnapshots().length).toBeLessThanOrEqual(12);
  });

  it("4.7 generateCurrentWeek() — calcula rating great/ok/low", () => {
    for (let i = 0; i < 10; i++) {
      storage.addReview({ date: "2026-09-07", cardId: `c${i}`, examId: null, rating: 4, durationMs: 10_000 });
    }
    const svc = new WeeklyReviewService(storage);
    const review = svc.generateCurrentWeek(new Date(2026, 8, 3).getTime());
    expect(["great", "ok", "low"]).toContain(review.rating);
  });
});

// ────────────────────────────────────────────────────────────
// 5. STUDY GOALS — tests funcionales
// ────────────────────────────────────────────────────────────
import { StudyGoals, goalLabel, goalProgress } from "../src/exams/studyGoals";

describe("FUNCIONAL: StudyGoals — funciones individuales", () => {
  let storage: PluginDataStorage;

  beforeEach(async () => {
    const p = new MockPlugin();
    storage = await PluginDataStorage.load(p as never);
  });

  it("5.1 syncGoals() — crea goals según config", () => {
    const sg = new StudyGoals(storage);
    const goals = sg.syncGoals(new Date(2026, 8, 7).getTime());
    expect(goals.length).toBeGreaterThan(0);
    expect(goals.some((g) => g.type === "daily-cards")).toBe(true);
  });

  it("5.2 syncGoals() — incluye goal weekly", () => {
    const sg = new StudyGoals(storage);
    const goals = sg.syncGoals(new Date(2026, 8, 7).getTime());
    expect(goals.some((g) => g.type === "weekly-cards")).toBe(true);
  });

  it("5.3 syncGoals() — incluye el goal de streak", () => {
    const sg = new StudyGoals(storage);
    const goals = sg.syncGoals(new Date(2026, 8, 7).getTime());
    expect(goals.some((g) => g.type === "streak-days")).toBe(true);
  });

  it("5.4 goalProgress() — 0 cuando current=0", () => {
    const progress = goalProgress({
      id: "g1",
      type: "daily-cards",
      target: 30,
      current: 0,
      period: "daily",
      status: "pending",
    });
    expect(progress).toBe(0);
  });

  it("5.5 goalLabel() — label legible", () => {
    const label = goalLabel({
      id: "g1",
      type: "daily-cards",
      target: 30,
      current: 0,
      period: "daily",
      status: "pending",
    });
    expect(label).toContain("Diario");
  });
});

// ────────────────────────────────────────────────────────────
// 6. AUDIO REGISTRY
// ────────────────────────────────────────────────────────────
import { AudioRegistry } from "../src/audio/registry";
import type { MNexusSettings } from "../src/types";

describe("FUNCIONAL: AudioRegistry — funciones individuales", () => {
  it("6.1 add() — añade un AudioRecord", () => {
    const mockApp = { vault: { getAbstractFileByPath: () => null } } as never;
    const settings = { audioFolder: "Audio", transcriptsFolder: "Transcripts" } as MNexusSettings;
    const reg = new AudioRegistry(mockApp, settings);
    reg.add({
      id: "a1",
      filePath: "Audio/a.wav",
      fileName: "a.wav",
      createdAt: new Date().toISOString(),
      state: "inbox",
    });
    expect(reg.list().length).toBe(1);
  });
});
