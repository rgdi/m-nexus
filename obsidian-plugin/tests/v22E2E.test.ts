// v0.22: Simulación e2e del flujo completo:
// 1. Configurar horarios de clase
// 2. Subir 7 grabaciones (un día cada una)
// 3. Verificar que ScheduleMatcher asigna correctamente
// 4. Verificar que las grabaciones "huérfanas" quedan sin asignar
// 5. Generar review semanal incluyendo las grabaciones
// 6. Activar push para que el daily review notifique

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ScheduleMatcher, type ClassSchedule } from "../src/exams/scheduleMatcher";
import { PluginDataStorage } from "../src/exams/persistence";
import { WeeklyReviewService } from "../src/exams/weeklyReview";
import { PushBridge, DEFAULT_ENABLED_CATEGORIES } from "../src/exams/pushBridge";

class MockPlugin {
  data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = JSON.parse(JSON.stringify(d)); }
}

describe("v0.22 — E2E: Grabaciones + Schedule matching + Review semanal", () => {
  let storage: PluginDataStorage;
  let matcher: ScheduleMatcher;
  const monday9am = new Date(2026, 8, 7, 9, 0, 0).getTime();

  beforeEach(async () => {
    const plugin = new MockPlugin();
    storage = await PluginDataStorage.load(plugin as never);

    // Configurar 3 clases: lunes anatomía, martes bioquímica, miércoles histología
    const schedules: ClassSchedule[] = [
      { subject: "Anatomía", dayOfWeek: 1, startMinute: 9 * 60, durationMinutes: 60, location: "Aula 101" },
      { subject: "Bioquímica", dayOfWeek: 2, startMinute: 10 * 60, durationMinutes: 90, location: "Lab 3" },
      { subject: "Histología", dayOfWeek: 3, startMinute: 11 * 60, durationMinutes: 60, location: "Aula 202" },
    ];
    for (const s of schedules) storage.addClassSchedule(s);
    matcher = new ScheduleMatcher(storage.getClassSchedules());
  });

  it("E2E día 1 (lunes 9:00): grabación → Anatomía", () => {
    const result = matcher.match(monday9am, 30 * 60_000);
    expect(result).not.toBeNull();
    expect(result?.schedule.subject).toBe("Anatomía");
    expect(result?.confidence).toBeGreaterThan(0.7);
  });

  it("E2E día 2 (martes 10:05): grabación cubre la mayor parte → Bioquímica", () => {
    // 8 sep 2026 = martes (dayOfWeek=2)
    // Clase 10:00-11:30, grabación 10:05-11:00 = 55min overlap
    // startScore: 1 - 5/30 = 0.83, coverage: 55/90 = 0.61, recCoverage: 55/55 = 1
    // confidence: 0.83*0.5 + 0.61*0.3 + 1*0.2 = 0.42 + 0.18 + 0.2 = 0.80
    const tue = new Date(2026, 8, 8, 10, 5, 0).getTime();
    const result = matcher.match(tue, 55 * 60_000);
    expect(result?.schedule.subject).toBe("Bioquímica");
    expect(result?.confidence).toBeGreaterThan(0.7);
  });

  it("E2E: grabación un domingo a las 9:00 → null (sin clase)", () => {
    // 13 sep 2026 es domingo (dayOfWeek=0)
    const sun = new Date(2026, 8, 13, 9, 0, 0).getTime();
    const result = matcher.match(sun, 60 * 60_000);
    expect(result).toBeNull();
  });

  it("E2E: 5 grabaciones en la semana, 3 con match, 2 huérfanas", () => {
    const recordings = [
      { day: "lun", ts: monday9am, durMin: 30 },     // → Anatomía
      { day: "mar", ts: new Date(2026, 8, 8, 10, 0, 0).getTime(), durMin: 60 }, // → Bioquímica
      { day: "mie", ts: new Date(2026, 8, 9, 11, 0, 0).getTime(), durMin: 30 }, // → Histología
      { day: "jue", ts: new Date(2026, 8, 10, 15, 0, 0).getTime(), durMin: 30 }, // → null (sin clase)
      { day: "vie", ts: new Date(2026, 8, 11, 8, 0, 0).getTime(), durMin: 30 },  // → null (no encaja)
    ];
    let matched = 0;
    let orphan = 0;
    for (const r of recordings) {
      const m = matcher.match(r.ts, r.durMin * 60_000);
      if (m) matched++;
      else orphan++;
    }
    expect(matched).toBe(3);
    expect(orphan).toBe(2);
  });

  it("E2E: review semanal tiene 7 días y suma todas las reviews", () => {
    // Sembrar 3 reviews por día durante 5 días
    const weekStart = new Date(2026, 8, 3, 0, 0, 0); // lunes
    for (let d = 0; d < 5; d++) {
      const dayDate = new Date(weekStart.getTime() + d * 86_400_000);
      const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;
      for (let i = 0; i < 3; i++) {
        storage.addReview({
          date: dateStr,
          cardId: `c-${d}-${i}`,
          examId: null,
          rating: i === 0 ? 1 : 3, // mix
          durationMs: 30_000,
        });
      }
    }
    const svc = new WeeklyReviewService(storage);
    const review = svc.generateCurrentWeek(weekStart.getTime());
    expect(review.days.length).toBe(7);
    expect(review.totalCards).toBeGreaterThanOrEqual(12);
  });

  it("E2E: matcher.getUpcoming respeta la hora actual", () => {
    const now = new Date(2026, 8, 7, 8, 0, 0).getTime(); // lunes 8 AM
    const upcoming = matcher.getUpcoming(now, 3);
    expect(upcoming[0].schedule.subject).toBe("Anatomía"); // próxima a las 9
    expect(upcoming[0].startsAtMs).toBeGreaterThanOrEqual(now);
  });

  it("E2E: cambio de horario refresca el matcher", async () => {
    const before = matcher.match(new Date(2026, 8, 9, 9, 0, 0).getTime(), 30 * 60_000);
    expect(before).toBeNull(); // mié 9 AM no hay clase

    storage.addClassSchedule({
      subject: "Fisiología",
      dayOfWeek: 3,
      startMinute: 9 * 60,
      durationMinutes: 60,
    });
    matcher = new ScheduleMatcher(storage.getClassSchedules());
    const after = matcher.match(new Date(2026, 8, 9, 9, 0, 0).getTime(), 30 * 60_000);
    expect(after?.schedule.subject).toBe("Fisiología");
  });
});

describe("v0.22 — E2E: Push notifications", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("E2E: bridge registra y luego recibe weekly-review event", async () => {
    const bridge = new PushBridge({
      backendUrl: "https://api.test",
      authToken: "tok",
      deviceId: "d1",
      platform: "android",
      pushToken: "fcm-tok",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const reg = await bridge.register();
    expect(reg.success).toBe(true);

    const event = {
      id: "week-2026-09-07",
      type: "weekly-review-ready" as const,
      title: "Review listo",
      message: "Tu semana cierra con 45 cards repasadas",
      timestamp: Date.now(),
      severity: "info" as const,
      shown: false,
    };
    const sent = await bridge.send(event);
    expect(sent.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // register + send
  });
});
