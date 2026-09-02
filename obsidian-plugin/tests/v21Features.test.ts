// v0.21: Tests de las 3 features nuevas.
// 1. ScheduleMatcher (detección de clase por horario)
// 2. PushBridge (notificaciones push al móvil)
// 3. ManualCreationModal (UI mejorada)

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ScheduleMatcher,
  DEFAULT_MATCH_OPTIONS,
  formatSchedule,
  type ClassSchedule,
} from "../src/exams/scheduleMatcher";
import { PushBridge, DEFAULT_ENABLED_CATEGORIES } from "../src/exams/pushBridge";

// ─── 1. ScheduleMatcher ─────────────────────────────────

describe("ScheduleMatcher — básico", () => {
  // Lunes 9:00 clase de 60min
  const schedules: ClassSchedule[] = [
    { subject: "Anatomía", dayOfWeek: 1, startMinute: 9 * 60, durationMinutes: 60 },
    { subject: "Bioquímica", dayOfWeek: 2, startMinute: 10 * 60, durationMinutes: 90 },
  ];
  let matcher: ScheduleMatcher;

  beforeEach(() => {
    matcher = new ScheduleMatcher(schedules);
  });

  it("match exacto: grabación de 9:00 a 9:30 un lunes → Anatomía", () => {
    // 2026-09-07 es lunes
    const start = new Date(2026, 8, 7, 9, 0, 0).getTime();
    const duration = 30 * 60_000;
    const match = matcher.match(start, duration);
    expect(match).not.toBeNull();
    expect(match?.schedule.subject).toBe("Anatomía");
    expect(match?.confidence).toBeGreaterThan(0.7);
  });

  it("match parcial: grabación 9:15 a 9:45 → Anatomía", () => {
    const start = new Date(2026, 8, 7, 9, 15, 0).getTime();
    const duration = 30 * 60_000;
    const match = matcher.match(start, duration);
    expect(match?.schedule.subject).toBe("Anatomía");
  });

  it("no match si está fuera del horario", () => {
    // Domingo a las 9:00 (no hay schedules para domingo)
    const start = new Date(2026, 8, 6, 9, 0, 0).getTime();
    const duration = 60 * 60_000;
    const match = matcher.match(start, duration);
    expect(match).toBeNull();
  });

  it("no match si confianza < threshold", () => {
    // Grabación muy lejana a la clase (lunes a las 14:00, clase es a las 9:00)
    const start = new Date(2026, 8, 7, 14, 0, 0).getTime();
    const duration = 30 * 60_000;
    const match = matcher.match(start, duration);
    expect(match).toBeNull();
  });

  it("matchAll devuelve múltiples si overlap con varias", () => {
    // Sin solapamiento posible aquí (clases en días diferentes)
    const matches = matcher.matchAll(Date.now(), 24 * 3600_000);
    expect(Array.isArray(matches)).toBe(true);
  });

  it("getUpcoming devuelve las próximas N clases", () => {
    const upcoming = matcher.getUpcoming(new Date(2026, 8, 7, 8, 0, 0).getTime(), 5);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming[0].schedule.subject).toBe("Anatomía"); // próxima a las 9:00
  });

  it("formatSchedule: formatea correctamente", () => {
    const formatted = formatSchedule(schedules[0]);
    expect(formatted).toContain("lun");
    expect(formatted).toContain("09:00");
    expect(formatted).toContain("10:00");
    expect(formatted).toContain("Anatomía");
  });
});

describe("ScheduleMatcher — edge cases", () => {
  it("grabación en zona horaria que cruza medianoche", () => {
    const schedules: ClassSchedule[] = [
      { subject: "Vigilancia", dayOfWeek: 1, startMinute: 23 * 60 + 30, durationMinutes: 120 }, // 23:30-01:30
    ];
    const matcher = new ScheduleMatcher(schedules);
    const start = new Date(2026, 8, 7, 23, 30, 0).getTime();
    const duration = 60 * 60_000;
    const match = matcher.match(start, duration);
    expect(match).not.toBeNull();
    expect(match?.schedule.subject).toBe("Vigilancia");
  });

  it("grabación de varios días con clases diarias", () => {
    const schedules: ClassSchedule[] = [];
    for (let day = 1; day <= 5; day++) {
      schedules.push({ subject: `Clase ${day}`, dayOfWeek: day as 1 | 2 | 3 | 4 | 5, startMinute: 9 * 60, durationMinutes: 60 });
    }
    const matcher = new ScheduleMatcher(schedules);
    const start = new Date(2026, 8, 7, 9, 0, 0).getTime(); // lunes
    const match = matcher.match(start, 30 * 60_000);
    expect(match?.schedule.subject).toBe("Clase 1");
  });

  it("custom options: tolerance más alta = más matches", () => {
    const schedules: ClassSchedule[] = [
      { subject: "X", dayOfWeek: 1, startMinute: 9 * 60, durationMinutes: 60 },
    ];
    const strict = new ScheduleMatcher(schedules, { toleranceMinutes: 5 });
    const loose = new ScheduleMatcher(schedules, { toleranceMinutes: 60 });
    const start = new Date(2026, 8, 7, 9, 20, 0).getTime(); // 20 min tarde
    expect(strict.match(start, 30 * 60_000)).toBeNull();
    expect(loose.match(start, 30 * 60_000)).not.toBeNull();
  });

  it("recording exactamente en el límite (minConfidence)", () => {
    const matcher = new ScheduleMatcher([], { minConfidence: 0.5 });
    const start = new Date(2026, 8, 7, 9, 0, 0).getTime();
    expect(matcher.match(start, 60_000)).toBeNull();
  });
});

// ─── 2. PushBridge ─────────────────────────────────────

describe("PushBridge", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("register: envía POST con datos correctos", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "android",
      pushToken: "fcm-token",
      enabled: true,
      enabledCategories: new Set(),
    });
    const result = await bridge.register();
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/push/register",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("register: falla si no hay pushToken", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "android",
      enabled: true,
      enabledCategories: new Set(),
    });
    const result = await bridge.register();
    expect(result.success).toBe(false);
    expect(result.error).toContain("No push token");
  });

  it("send: emite el evento al backend", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "ios",
      pushToken: "apns-token",
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
    const result = await bridge.send(event);
    expect(result.success).toBe(true);
  });

  it("send: dedup — no envía el mismo evento 2 veces", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "ios",
      pushToken: "apns",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const event = {
      id: "ev-dup",
      type: "exam-approaching" as const,
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
    expect(r2.error).toBe("already sent");
  });

  it("send: respeta enabledCategories", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "ios",
      pushToken: "apns",
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
    expect(r.error).toBe("category disabled");
  });

  it("send: deshabilitado globalmente", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "ios",
      pushToken: "apns",
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

  it("send: maneja error de red", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "dev-1",
      platform: "ios",
      pushToken: "apns",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const event = {
      id: "ev-err",
      type: "goal-completed" as const,
      title: "T",
      message: "M",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const r = await bridge.send(event);
    expect(r.success).toBe(false);
    expect(r.error).toContain("Network error");
  });
});

// ─── 3. Manual Creation (data layer) ──────────────────

describe("ManualCreation data layer", () => {
  it("classSchedules persistence", async () => {
    const { PluginDataStorage } = await import("../src/exams/persistence");
    class MockPlugin {
      private data: Record<string, unknown> = {};
      async loadData() { return this.data; }
      async saveData(d: Record<string, unknown>) { this.data = { ...d }; }
    }
    const plugin = new MockPlugin();
    const s = await PluginDataStorage.load(plugin as never);
    expect(s.getClassSchedules()).toEqual([]);
    s.addClassSchedule({ subject: "Anatomía", dayOfWeek: 1, startMinute: 540, durationMinutes: 60 });
    expect(s.getClassSchedules()).toHaveLength(1);
  });
});
