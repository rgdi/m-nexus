// v0.18: Tests específicos de los 3 bug fixes.
//
// Fix 1: Clock skew detection
// Fix 2: SafeFlush con UI feedback
// Fix 3: Focus mode skipea el tick (CPU waste fix)

import { describe, it, expect, beforeEach } from "vitest";
import { PluginDataStorage } from "../src/exams/persistence";
import { PersistentStreakTracker } from "../src/exams/persistentStreak";
import { SafeFlush } from "../src/exams/safeFlush";
import { AdherenceMonitorV2 } from "../src/exams/monitorV2";
import { NotificationServiceV2 } from "../src/exams/notificationsV2";
import { PersistentAdherenceStore } from "../src/exams/persistentAdherence";
import { detectClockSkew, CLOCK_SKEW_THRESHOLD_MS, ClockSkewDetector } from "../src/exams/clockUtils";
import type { Exam } from "../src/exams/types";

class MockPlugin {
  private data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
  _setData(d: Record<string, unknown>) { this.data = { ...d }; }
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Fix 1: Clock skew detection ─────────────────────────

describe("Fix 1: Clock skew detection", () => {
  it("detectClockSkew: null → no skew", () => {
    const r = detectClockSkew(null, 1000);
    expect(r.skewed).toBe(false);
  });

  it("detectClockSkew: gap < threshold → no skew", () => {
    const r = detectClockSkew(1000, 1000 + 3600 * 1000); // 1h
    expect(r.skewed).toBe(false);
  });

  it("detectClockSkew: gap > threshold forward", () => {
    const r = detectClockSkew(1000, 1000 + 3 * 3600 * 1000); // 3h
    expect(r.skewed).toBe(true);
    expect(r.direction).toBe("forward");
  });

  it("detectClockSkew: gap > threshold backward (reloj atrasado)", () => {
    const r = detectClockSkew(1000, 1000 - 3 * 3600 * 1000);
    expect(r.skewed).toBe(true);
    expect(r.direction).toBe("backward");
  });

  it("ClockSkewDetector: track events", () => {
    const d = new ClockSkewDetector();
    d.tick(1000);
    expect(d.hasSkew()).toBe(false);
    d.tick(1000 + 5 * 3600 * 1000); // 5h después
    expect(d.hasSkew()).toBe(true);
    expect(d.events[0].direction).toBe("forward");
  });

  it("StreakTracker: registra clock skew forward", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    // Primer estudio
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 });
    // Segundo estudio 5h después con la misma fecha
    const r = t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 + 5 * 3600 * 1000 });
    expect(t.hasClockSkew()).toBe(true);
    const events = t.getSkewEvents();
    expect(events[0].direction).toBe("forward");
  });

  it("StreakTracker: clock skew forward mantiene racha si el día consecutivo", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    // Día 0 a las 23:00
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: Date.parse(dayOffset(0) + "T23:00:00") });
    // Salto de reloj: ahora es día 1 a las 02:00 (5h después)
    t.recordStudy({ date: dayOffset(1), cardsReviewed: 1, durationMs: 100, timestamp: Date.parse(dayOffset(1) + "T02:00:00") });
    expect(t.getCurrent()).toBe(2);
  });

  it("StreakTracker: clock skew backward no rompe racha", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    // Día 0 a las 10:00
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: Date.parse(dayOffset(0) + "T10:00:00") });
    // Salto backward: día -1 a las 23:00
    t.recordStudy({ date: dayOffset(-1), cardsReviewed: 1, durationMs: 100, timestamp: Date.parse(dayOffset(-1) + "T23:00:00") });
    // El session.date es anterior al lastStudyDate. NO debe romper.
    expect(t.getCurrent()).toBeGreaterThanOrEqual(1);
  });

  it("getSkewEvents devuelve una copia", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 });
    t.recordStudy({ date: dayOffset(0), cardsReviewed: 1, durationMs: 100, timestamp: 1000 + 5 * 3600 * 1000 });
    const events = t.getSkewEvents();
    expect(events).toHaveLength(1);
    events.push({ at: 999, direction: "forward", amount: 0 }); // mutar copia
    expect(t.getSkewEvents()).toHaveLength(1); // no afecta al original
  });

  it("Skew events cap a 20", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const t = new PersistentStreakTracker(s);
    for (let i = 0; i < 30; i++) {
      t.recordStudy({
        date: dayOffset(0),
        cardsReviewed: 1,
        durationMs: 100,
        timestamp: 1000 + i * (5 * 3600 * 1000),
      });
    }
    expect(t.getSkewEvents().length).toBeLessThanOrEqual(20);
  });
});

// ─── Fix 2: SafeFlush con UI feedback ─────────────────────

describe("Fix 2: SafeFlush con UI feedback", () => {
  let notices: string[] = [];

  beforeEach(() => {
    notices = [];
  });

  it("flush exitoso: 1 intento", async () => {
    const plugin = new MockPlugin();
    const storage = await PluginDataStorage.load(plugin as never);
    const sf = new SafeFlush(storage, {
      showNoticeFn: (msg) => notices.push(msg),
      log: () => {},
    });
    const result = await sf.flush();
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("flush con retry: 1 falla, 2 éxito", async () => {
    let attempts = 0;
    class FlakyPlugin {
      private data: Record<string, unknown> = {};
      async loadData() { return this.data; }
      async saveData(d: Record<string, unknown>) {
        attempts++;
        if (attempts === 1) throw new Error("Network error");
        this.data = { ...d };
      }
    }
    const storage = new FlakyPlugin() as never;
    const plugin = await PluginDataStorage.load(storage as never);
    // Override saveNow con la versión flaky
    const flakyStorage = {
      ...plugin,
      saveNow: async () => {
        const sp = storage as unknown as { saveData: (d: Record<string, unknown>) => Promise<void> };
        await sp.saveData({});
      },
    };
    const sf = new SafeFlush(flakyStorage as never, {
      showNoticeFn: (msg) => notices.push(msg),
      log: () => {},
      initialDelay: 10,
      backoffFactor: 1,
    });
    const result = await sf.flush();
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("flush falla 3 veces: pending activado", async () => {
    class BrokenPlugin {
      private data: Record<string, unknown> = {};
      async loadData() { return this.data; }
      async saveData(_d: Record<string, unknown>) {
        throw new Error("Always fails");
      }
    }
    const plugin = new MockPlugin();
    const storage = await PluginDataStorage.load(plugin as never);
    // Override saveNow
    const brokenSave = storage.saveNow.bind(storage);
    storage.saveNow = async () => {
      const p = new BrokenPlugin() as unknown as { saveData: (d: Record<string, unknown>) => Promise<void> };
      await p.saveData({});
    };
    void brokenSave;
    const sf = new SafeFlush(storage, {
      showNoticeFn: (msg) => notices.push(msg),
      log: () => {},
      maxRetries: 3,
      initialDelay: 1,
      backoffFactor: 1,
    });
    const result = await sf.flush();
    expect(result.success).toBe(false);
    expect(sf.hasPending()).toBe(true);
    expect(notices.length).toBeGreaterThan(0); // al menos 1 Notice
    expect(notices[0]).toContain("No se pudieron guardar");
  });

  it("lastResult es accesible", async () => {
    const plugin = new MockPlugin();
    const storage = await PluginDataStorage.load(plugin as never);
    const sf = new SafeFlush(storage, { showNotice: false });
    await sf.flush();
    expect(sf.lastResult?.success).toBe(true);
  });

  it("onFlush callback se llama", async () => {
    const plugin = new MockPlugin();
    const storage = await PluginDataStorage.load(plugin as never);
    const sf = new SafeFlush(storage, { showNotice: false });
    let called = false;
    sf.onFlush = () => { called = true; };
    await sf.flush();
    expect(called).toBe(true);
  });
});

// ─── Fix 3: Focus mode skipea el tick ─────────────────────

describe("Fix 3: Focus mode skipea el tick", () => {
  function makeExam(): Exam {
    const d = new Date();
    d.setDate(d.getDate() + 1);
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

  it("focus mode: tick retorna [] y no llama detectores", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1] },
      { read: () => null, write: () => {} }
    );
    const store = new PersistentAdherenceStore(s);
    const exam = makeExam();
    let detectCalls = 0;
    const origDetect = notif.detectExamApproaching.bind(notif);
    notif.detectExamApproaching = (exams) => {
      detectCalls++;
      return origDetect(exams);
    };
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [exam] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInFocusMode: () => true,
      }
    );
    const events = monitor.tick();
    expect(events).toEqual([]);
    expect(detectCalls).toBe(0); // CRÍTICO: no se llama
    expect(monitor.getTotalSkippedByFocus()).toBe(1);
  });

  it("focus mode off: tick llama detectores normalmente", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1], dedupHours: 0 },
      { read: () => null, write: () => {} }
    );
    const store = new PersistentAdherenceStore(s);
    const exam = makeExam();
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [exam] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInFocusMode: () => false,
      }
    );
    const events = monitor.tick();
    expect(events.some((e) => e.type === "exam-approaching")).toBe(true);
    expect(monitor.getTotalSkippedByFocus()).toBe(0);
  });

  it("focus mode cambia mid-stream: tick respeta el estado actual", async () => {
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    const streak = new PersistentStreakTracker(s);
    const notif = new NotificationServiceV2(
      { examApproachingDays: [1], dedupHours: 0 },
      { read: () => null, write: () => {} }
    );
    const store = new PersistentAdherenceStore(s);
    const exam = makeExam();
    let isFocus = true;
    const monitor = new AdherenceMonitorV2(
      { intervalHours: 999, enabled: true },
      {
        examManager: { list: () => [exam] },
        notificationService: notif,
        streakTracker: streak,
        adherenceStore: store,
        useRealTimer: false,
        isInFocusMode: () => isFocus,
      }
    );
    // En focus: skipea
    expect(monitor.tick()).toEqual([]);
    expect(monitor.getTotalSkippedByFocus()).toBe(1);
    // Sale de focus
    isFocus = false;
    expect(monitor.tick().length).toBeGreaterThan(0);
    expect(monitor.getTotalSkippedByFocus()).toBe(1); // sigue en 1
  });

  it("contador skippedByFocus independiente de totalChecks", async () => {
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
        isInFocusMode: () => true,
      }
    );
    monitor.tick();
    monitor.tick();
    monitor.tick();
    expect(monitor.getTotalChecks()).toBe(3);
    expect(monitor.getTotalSkippedByFocus()).toBe(3);
  });
});
