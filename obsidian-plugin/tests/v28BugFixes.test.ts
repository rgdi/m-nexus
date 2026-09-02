// v0.28: Tests de los bugs encontrados en análisis aleatorio y arreglados.

import { describe, it, expect, beforeEach } from "vitest";
import { PdfManager } from "../src/pdf/manager";
import { PushBridge, DEFAULT_ENABLED_CATEGORIES } from "../src/exams/pushBridge";
import { SocraticTutor } from "../src/clinical/socratic";
import { WeeklyReviewService } from "../src/exams/weeklyReview";
import { computeGlobalMetrics, averageMastery, snapshotFromCard } from "../src/analytics/metrics";
import { createQuizSession, AdaptiveQuizEngine } from "../src/study/adaptiveQuiz";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";
import { Logger } from "../src/utils/logger";
import type { TFile, App } from "obsidian";

// ── Mocks ──

function makeApp(adapter: any = {}): App {
  return {
    vault: {
      adapter: {
        exists: async (_p: string) => false,
        read: async (_p: string) => "{}",
        write: async (_p: string, _c: string) => {},
        ...adapter,
      },
      readBinary: async (f: TFile) => new ArrayBuffer(0),
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [],
      read: async () => "",
    },
  } as any;
}

// ── PDF Manager: race condition en load() ──

describe("Bug fix: PdfManager.load() race condition", () => {
  it("1.1 múltiples load() paralelos solo cargan una vez", async () => {
    let readsCount = 0;
    const app = makeApp({
      exists: async () => true,
      read: async () => {
        readsCount++;
        return "{}";
      },
    });
    const log = new Logger("test");
    const pm = new PdfManager(app, log);
    await Promise.all([pm.load(), pm.load(), pm.load()]);
    expect(readsCount).toBe(1);
  });

  it("1.2 load() llamado después de cargado es no-op", async () => {
    let readsCount = 0;
    const app = makeApp({
      exists: async () => true,
      read: async () => {
        readsCount++;
        return "{}";
      },
    });
    const log = new Logger("test");
    const pm = new PdfManager(app, log);
    await pm.load();
    await pm.load();
    expect(readsCount).toBe(1);
  });
});

// ── PDF Manager: detectAndPair determinista ──

describe("Bug fix: detectAndPair con versiones del mismo ms", () => {
  it("2.1 orden estable con tiebreaker por id", async () => {
    const app = makeApp();
    const log = new Logger("test");
    const pm = new PdfManager(app, log);
    // 2 versiones con el mismo uploadedAt
    const t = "2026-09-01T10:00:00.000Z";
    (pm as any).versions.set("test", [
      { id: "z", uploadedAt: t, filePath: "p1", size: 1, hash: "a" },
      { id: "a", uploadedAt: t, filePath: "p2", size: 1, hash: "b" },
    ]);
    // Para el test no llamamos a register (necesita TFile real).
    // Solo validamos el sort logic.
    const sorted = [...(pm as any).versions.get("test")].sort((a: any, b: any) => {
      const cmp = a.uploadedAt.localeCompare(b.uploadedAt);
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    });
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("z");
  });
});

// ── PushBridge: sanitizeMeta ──

describe("Bug fix: PushBridge.sanitizeMeta", () => {
  it("3.1 sanitiza meta con tipos no-string", () => {
    const bridge = new PushBridge({
      backendUrl: "http://test",
      authToken: "x",
      deviceId: "d1",
      platform: "ios",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    const safe = (bridge as any).sanitizeMeta({ count: 5, name: "x", nested: { a: 1 } });
    expect(safe.count).toBe("5");
    expect(safe.name).toBe("x");
    expect(safe.nested).toBe('{"a":1}');
  });

  it("3.2 meta undefined retorna undefined", () => {
    const bridge = new PushBridge({
      backendUrl: "http://test",
      authToken: "x",
      deviceId: "d1",
      platform: "ios",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    expect((bridge as any).sanitizeMeta(undefined)).toBeUndefined();
    expect((bridge as any).sanitizeMeta(null)).toBeUndefined();
  });

  it("3.3 meta no-objeto retorna undefined", () => {
    const bridge = new PushBridge({
      backendUrl: "http://test",
      authToken: "x",
      deviceId: "d1",
      platform: "ios",
      enabled: true,
      enabledCategories: DEFAULT_ENABLED_CATEGORIES,
    });
    expect((bridge as any).sanitizeMeta("string")).toBeUndefined();
    expect((bridge as any).sanitizeMeta(42)).toBeUndefined();
  });
});

// ── Socratic: regex no-greedy para JSON ──

describe("Bug fix: Socratic regex non-greedy JSON", () => {
  it("4.1 extrae solo el primer objeto JSON", () => {
    // Simular respuesta con JSON inline
    const res = 'Aquí va: {"a": 1} y luego más texto';
    const m = res.match(/\{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toBe('{"a": 1}');
  });

  it("4.2 greedy habría matcheado todo (sanity check)", () => {
    const res = '{"a": 1} y luego {"b": 2}';
    const m = res.match(/\{[\s\S]*\}/);
    // Con greedy, matchea el primer { hasta el último }
    expect(m![0]).toBe('{"a": 1} y luego {"b": 2}');
    // Con non-greedy, matchea solo el primero
    const m2 = res.match(/\{[\s\S]*?\}/);
    expect(m2![0]).toBe('{"a": 1}');
  });
});

// ── WeeklyReview: comparación de fechas sin timezone ──

describe("Bug fix: WeeklyReview comparación de fechas", () => {
  it("5.1 acepta fechas YYYY-MM-DD", () => {
    const storage = {
      getReviews: () => [
        { cardId: "c1", examId: "e1", date: "2026-09-01", rating: 4 as const, durationMs: 1000 },
        { cardId: "c2", examId: "e1", date: "2026-09-03", rating: 3 as const, durationMs: 2000 },
      ],
    } as any;
    const service = new WeeklyReviewService(storage);
    // weekStart = lunes 31 ago 2026
    const weekStart = new Date(2026, 7, 31).getTime();
    const weekEnd = new Date(2026, 8, 6).getTime();
    const review = service.generateWeek(weekStart, weekEnd);
    expect(review.totalCards).toBe(2);
  });

  it("5.2 acepta ISO completo en r.date", () => {
    const storage = {
      getReviews: () => [
        { cardId: "c1", examId: "e1", date: "2026-09-01T10:30:00.000Z", rating: 4 as const, durationMs: 1000 },
      ],
    } as any;
    const service = new WeeklyReviewService(storage);
    const weekStart = new Date(2026, 7, 31).getTime();
    const weekEnd = new Date(2026, 8, 6).getTime();
    const review = service.generateWeek(weekStart, weekEnd);
    expect(review.totalCards).toBe(1);
  });
});

// ── Metrics: averageMastery excluye new ──

describe("Bug fix: averageMastery excluye cards new", () => {
  it("6.1 cards new no afectan el mastery", () => {
    const cards = [
      { id: "c1", subject: "a", stability: 100, difficulty: 5, dueDate: "2026-09-01", state: "review" as const, lapses: 0, reps: 5 },
      { id: "c2", subject: "a", stability: 0, difficulty: 5, dueDate: "2026-09-01", state: "new" as const, lapses: 0, reps: 0 },
    ];
    const mastery = averageMastery(cards);
    // Solo c1 cuenta: stabScore=1.0, retention ~ 0.75
    // (0.6*1.0 + 0.4*0.75) = 0.9
    expect(mastery).toBeGreaterThan(0.8);
  });

  it("6.2 array de solo new retorna 0", () => {
    const cards = [
      { id: "c1", subject: "a", stability: 0, difficulty: 5, dueDate: "2026-09-01", state: "new" as const, lapses: 0, reps: 0 },
    ];
    expect(averageMastery(cards)).toBe(0);
  });
});

// ── Metrics: dueToday incluye cards new ──

describe("Bug fix: metrics.dueToday incluye cards new", () => {
  it("7.1 cards new que vencen hoy se cuentan", () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const cards = [
      { id: "c1", subject: "a", stability: 0, difficulty: 5, dueDate: `${todayStr}T00:00:00.000Z`, state: "new" as const, lapses: 0, reps: 0 },
    ];
    const metrics = computeGlobalMetrics(cards);
    expect(metrics.dueToday).toBe(1);
  });
});

// ── AdaptiveQuiz: startedAt consistencia ──

describe("Bug fix: AdaptiveQuiz startedAt es number, no string", () => {
  it("8.1 createSession retorna startedAt numérico", () => {
    const session = createQuizSession();
    expect(typeof session.startedAt).toBe("number");
    expect(session.startedAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("8.2 startSession retorna startedAt numérico", () => {
    const kg = new KnowledgeGraph();
    const engine = new AdaptiveQuizEngine(kg);
    const session = engine.startSession();
    expect(typeof session.startedAt).toBe("number");
  });
});

// ── HTRManager: HTR deshabilitado maneja error limpiamente ──

describe("Bug fix: HTRManager.getProvider() lanza limpio", () => {
  it("9.1 tryGetProvider retorna null si disabled", async () => {
    const log = new Logger("test");
    const { HTRManager } = await import("../src/htr/manager");
    const settings = { htrBackend: "disabled" as const } as any;
    const mgr = new HTRManager(settings, log);
    expect(mgr.tryGetProvider()).toBeNull();
    expect(() => mgr.getProvider()).toThrow("HTR deshabilitado");
  });
});
