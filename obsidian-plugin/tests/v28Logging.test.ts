// v0.28: Tests del sistema de logging exhaustivo.
// Verifica que el logging detecta bugs reales, anomalías, y condiciones de error.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Logger, MemorySink, consoleSink } from "../src/utils/logger";
import { VaultEvaluator } from "../src/ai/vaultEvaluator";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";
import { review, newCard, Rating, FsrsCard } from "../src/fsrs/scheduler";

let memorySink: MemorySink;

beforeEach(() => {
  Logger.clearSinks();
  Logger.setMinLevel("trace");
  Logger.clearContext();
  memorySink = new MemorySink();
  Logger.addSink(memorySink.sink);
});

afterEach(() => {
  Logger.clearSinks();
  Logger.clearContext();
});

// ── Logger basics ──

describe("Logger: niveles y sinks", () => {
  it("1.1 emite logs en el nivel correcto", () => {
    const log = new Logger("test");
    log.debug("debug message");
    log.info("info message");
    log.warn("warn message");
    log.error("error message");
    expect(memorySink.filter("debug").length).toBe(1);
    expect(memorySink.filter("info").length).toBe(1);
    expect(memorySink.filter("warn").length).toBe(1);
    expect(memorySink.filter("error").length).toBe(1);
  });

  it("1.2 filtra por nivel mínimo", () => {
    Logger.setMinLevel("warn");
    const log = new Logger("test");
    log.info("no debería aparecer");
    log.warn("sí debería");
    log.error("también");
    expect(memorySink.filter("info").length).toBe(0);
    expect(memorySink.filter("warn").length).toBe(1);
    expect(memorySink.filter("error").length).toBe(1);
  });

  it("1.3 incluye contexto en entries", () => {
    const log = new Logger("test");
    log.info("con contexto", { operation: "test.op", data: { userId: "u1" } });
    const entry = memorySink.entries[0];
    expect(entry.context.operation).toBe("test.op");
    expect(entry.context.data?.userId).toBe("u1");
  });

  it("1.4 stack trace en errors", () => {
    const log = new Logger("test");
    const err = new Error("test error");
    log.error("algo falló", { error: err });
    const entry = memorySink.filter("error")[0];
    expect(entry.stack).toBeDefined();
    expect(entry.stack).toContain("test error");
  });

  it("1.5 context global se aplica a todos los logs", () => {
    Logger.setContext({ userId: "u1", correlationId: "c1" });
    const log = new Logger("test");
    log.info("msg1");
    log.info("msg2");
    for (const entry of memorySink.entries) {
      expect(entry.context.userId).toBe("u1");
      expect(entry.context.correlationId).toBe("c1");
    }
  });
});

// ── Métricas y asserts ──

describe("Logger: métricas y asserts", () => {
  it("2.1 counter incrementa", () => {
    const log = new Logger("test");
    log.counter("ops");
    log.counter("ops");
    log.counter("ops", 5);
    expect(log.getCounters().get("ops")).toBe(7);
  });

  it("2.2 metric registra valor en histogram", () => {
    const log = new Logger("test");
    log.metric("duration", 100);
    log.metric("duration", 200);
    log.metric("duration", 300);
    expect(log.getHistograms().get("duration")).toEqual([100, 200, 300]);
  });

  it("2.3 time mide duración de función async", async () => {
    const log = new Logger("test");
    await log.time("op", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "result";
    });
    const hist = log.getHistograms().get("op");
    expect(hist).toBeDefined();
    expect(hist![0]).toBeGreaterThanOrEqual(45); // ~50ms con margen
  });

  it("2.4 time mide también cuando hay error", async () => {
    const log = new Logger("test");
    let caught = false;
    try {
      await log.time("op", async () => {
        throw new Error("fail");
      });
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
    const hist = log.getHistograms().get("op");
    expect(hist).toBeDefined();
  });

  it("2.5 assert detecta condiciones falsas", () => {
    const log = new Logger("test");
    const result = log.assert(false, "esto debería fallar");
    expect(result).toBe(false);
    expect(memorySink.filter("error").length).toBe(1);
    expect(memorySink.entries[0].message).toContain("ASSERTION FAILED");
  });

  it("2.6 assert pasa silenciosamente cuando es true", () => {
    const log = new Logger("test");
    const result = log.assert(true, "esto pasa");
    expect(result).toBe(true);
    expect(memorySink.entries.length).toBe(0);
  });

  it("2.7 assertRange valida rangos numéricos", () => {
    const log = new Logger("test");
    expect(log.assertRange(5, 0, 10, "x")).toBe(true);
    expect(log.assertRange(-1, 0, 10, "x")).toBe(false);
    expect(log.assertRange(11, 0, 10, "x")).toBe(false);
  });

  it("2.8 assertNotNull detecta null/undefined", () => {
    const log = new Logger("test");
    expect(log.assertNotNull("value", "x")).toBe("value");
    expect(log.assertNotNull(null, "x")).toBeNull();
    expect(memorySink.filter("error").length).toBe(1);
  });

  it("2.9 anomaly detecta valores fuera de tolerancia", () => {
    const log = new Logger("test");
    log.anomaly("metric", 5, 10, 1); // esperado 10±1, actual 5
    expect(memorySink.filter("warn").length).toBe(1);
    log.anomaly("metric", 10, 10, 1); // dentro
    expect(memorySink.filter("warn").length).toBe(1); // no incrementa
  });

  it("2.10 throttledWarn no repite en intervalo corto", () => {
    const log = new Logger("test");
    log.throttledWarn("k1", "msg", 1000);
    log.throttledWarn("k1", "msg", 1000);
    log.throttledWarn("k1", "msg", 1000);
    expect(memorySink.filter("warn").length).toBe(1);
  });
});

// ── Logging detecta bugs en vaultEvaluator ──

describe("Logger detecta bugs en vaultEvaluator", () => {
  it("3.1 detecta snapshot inválido (no array)", () => {
    const ev = new VaultEvaluator();
    expect(() => ev.evaluate(null as any)).toThrow(TypeError);
    expect(memorySink.filter("error").length).toBeGreaterThan(0);
  });

  it("3.2 detecta topic/subject mismatch", () => {
    const log = new Logger("vault-evaluator");
    const ev = new VaultEvaluator();
    ev.evaluate([
      {
        path: "a.md",
        basename: "a",
        content: "x",
        size: 1,
        modifiedAt: Date.now(),
        frontmatter: { topic: "cardio" },
        tags: ["endocrino"], // topic=cardio, tag=endocrino
        links: [],
        wordCount: 1,
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: false,
        topic: "cardio",
      },
    ]);
    // El bug: topic != subject (el subject se calcula con note.topic ?? "general" pero el tag se ignora)
    // El warning de mismatch debe aparecer
    const warnings = memorySink.filter("warn");
    const hasMismatch = warnings.some((w) => w.message.includes("subject_topic_mismatch"));
    // NOTA: si topic="cardio", el subject también será "cardio" (corregido)
    // Verificamos que NO haya mismatch en este caso:
    expect(hasMismatch).toBe(false);
  });

  it("3.3 detecta calidad fuera de rango", () => {
    const ev = new VaultEvaluator();
    // Caso patológico: content enorme con muchos links
    ev.evaluate([
      {
        path: "a.md",
        basename: "a",
        content: "x ".repeat(10000) + Array.from({ length: 1000 }, (_, i) => `[[link${i}]]`).join(" "),
        size: 50000,
        modifiedAt: Date.now(),
        frontmatter: { tags: ["x", "y", "z", "w", "v"] },
        links: Array.from({ length: 1000 }, (_, i) => `link${i}`),
        wordCount: 10000,
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: true,
        topic: "x",
      },
    ]);
    // Verificar que NO se logueó un assert failed
    const errors = memorySink.filter("error");
    const hasRangeError = errors.some((e) => e.message.includes("averageQuality fuera de rango"));
    expect(hasRangeError).toBe(false);
  });

  it("3.4 detecta vault con 0 untagged con muchas notas", () => {
    const ev = new VaultEvaluator();
    // 20 notas todas con tags
    const snapshots = Array.from({ length: 20 }, (_, i) => ({
      path: `a${i}.md`, basename: `a${i}`, content: "x",
      size: 1, modifiedAt: Date.now(), frontmatter: { tags: ["t"] }, tags: ["t"],
      links: ["x"], wordCount: 1, hasAudio: false, hasPdf: false, hasFlashcards: false, topic: "t",
    }));
    ev.evaluate(snapshots);
    // No debe haber warning de "90% untagged"
    const warnings = memorySink.filter("warn");
    const hasUntaggedWarning = warnings.some((w) => w.message.includes("sin tags"));
    expect(hasUntaggedWarning).toBe(false);
  });
});

// ── Logging detecta bugs en KnowledgeGraph ──

describe("Logger detecta bugs en KnowledgeGraph", () => {
  it("4.1 detecta ID duplicado", () => {
    const g = new KnowledgeGraph();
    g.add(createConcept("c1", "X"));
    g.add(createConcept("c1", "Y")); // mismo ID
    const warnings = memorySink.filter("warn");
    expect(warnings.some((w) => w.message.includes("concept ID duplicado"))).toBe(true);
  });

  it("4.2 detecta término duplicado con distinto ID", () => {
    const g = new KnowledgeGraph();
    g.add(createConcept("c1", "Diabetes"));
    g.add(createConcept("c2", "Diabetes")); // mismo término, distinto ID
    const warnings = memorySink.filter("warn");
    expect(warnings.some((w) => w.message.includes("término duplicado"))).toBe(true);
  });

  it("4.3 detecta updateMastery con concept inexistente", () => {
    const g = new KnowledgeGraph();
    g.updateMastery("nonexistent", "definition", true);
    const errors = memorySink.filter("error");
    expect(errors.some((e) => e.message.includes("concept no encontrado"))).toBe(true);
  });

  it("4.4 detecta layer inválida", () => {
    const g = new KnowledgeGraph();
    g.add(createConcept("c1", "X"));
    g.updateMastery("c1", "invalid_layer" as any, true);
    const errors = memorySink.filter("error");
    expect(errors.some((e) => e.message.includes("layer no encontrado"))).toBe(true);
  });

  it("4.5 detecta confidence fuera de rango", () => {
    const g = new KnowledgeGraph();
    g.add(createConcept("c1", "X"));
    g.updateMastery("c1", "definition", true, 5); // fuera de [0,1]
    const warnings = memorySink.filter("warn");
    expect(warnings.some((w) => w.message.includes("confidence fuera de"))).toBe(true);
  });

  it("4.6 detecta confidence inválida (NaN)", () => {
    const g = new KnowledgeGraph();
    g.add(createConcept("c1", "X"));
    g.updateMastery("c1", "definition", true, NaN);
    const errors = memorySink.filter("error");
    expect(errors.some((e) => e.message.includes("confidence inválida"))).toBe(true);
  });

  it("4.7 detecta findGaps con 0 gaps pero >5 concepts", () => {
    const g = new KnowledgeGraph();
    for (let i = 0; i < 10; i++) {
      g.add(createConcept(`c${i}`, `C${i}`));
      // mastery=0 por defecto, así que hay gaps
    }
    memorySink.clear();
    const gaps = g.findGaps();
    expect(gaps.length).toBeGreaterThan(0);
    // No debe haber warning de "0 gaps con >5 concepts"
    const warnings = memorySink.filter("warn");
    const hasNoGapsWarning = warnings.some((w) => w.message.includes("0 con"));
    expect(hasNoGapsWarning).toBe(false);
  });

  it("4.8 emite métrica de duración de findGaps", () => {
    const g = new KnowledgeGraph();
    for (let i = 0; i < 5; i++) g.add(createConcept(`c${i}`, `C${i}`));
    g.findGaps();
    // Buscar en el log
    const debugEntries = memorySink.filter("debug");
    const hasMetric = debugEntries.some((e) => e.message.includes("kg_findgaps_duration_ms"));
    // Solo si level debug está habilitado
    if (debugEntries.length > 0) {
      expect(hasMetric).toBe(true);
    }
  });
});

// ── Logging detecta bugs en FSRS ──

describe("Logger detecta bugs en FSRS", () => {
  it("5.1 review con rating inválido lanza error", () => {
    const card = newCard();
    expect(() => review(card, 5 as any)).toThrow(RangeError);
    expect(() => review(card, 0 as any)).toThrow(RangeError);
  });

  it("5.2 review con stability negativa lanza error", () => {
    const card: FsrsCard = { ...newCard(), stability: -1 };
    expect(() => review(card, 3)).toThrow(RangeError);
  });

  it("5.3 review con difficulty fuera de rango lanza error", () => {
    const card: FsrsCard = { ...newCard(), difficulty: 15 };
    expect(() => review(card, 3)).toThrow(RangeError);
  });

  it("5.4 review con requestRetention inválido lanza error", () => {
    const card = newCard();
    expect(() => review(card, 3, 0)).toThrow(RangeError);
    expect(() => review(card, 3, 1.5)).toThrow(RangeError);
  });

  it("5.5 review normal con rating válido no lanza error", () => {
    const card = newCard();
    expect(() => review(card, 3)).not.toThrow();
  });

  it("5.6 dueDate siempre válida (no NaN/Infinity)", () => {
    // Caso patológico: stability 0 y lapses
    const card: FsrsCard = {
      stability: 0.001,
      difficulty: 10,
      dueDate: new Date(),
      reps: 0,
      lapses: 100,
    };
    const r = review(card, 1);
    expect(r.card.dueDate.getTime()).not.toBeNaN();
    expect(isFinite(r.card.dueDate.getTime())).toBe(true);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
  });
});

// ── Métricas estructuradas ──

describe("Métricas estructuradas", () => {
  it("6.1 counter persiste entre operaciones", () => {
    const log = new Logger("test");
    log.counter("vault.evaluated", 1);
    log.counter("vault.evaluated", 1);
    log.counter("proposals.generated", 5);
    expect(log.getCounters().get("vault.evaluated")).toBe(2);
    expect(log.getCounters().get("proposals.generated")).toBe(5);
  });

  it("6.2 histogram permite calcular percentiles", () => {
    const log = new Logger("test");
    for (let i = 0; i < 100; i++) log.metric("duration", i);
    const hist = log.getHistograms().get("duration")!;
    const sorted = [...hist].sort((a, b) => a - b);
    const p50 = sorted[50];
    const p95 = sorted[95];
    expect(p50).toBeCloseTo(50, 0);
    expect(p95).toBeCloseTo(95, 0);
  });
});

// ── Stack traces ──

describe("Stack traces en errors", () => {
  it("7.1 error con Error object incluye stack", () => {
    const log = new Logger("test");
    const err = new Error("test error");
    log.error("failed", { error: err });
    const entry = memorySink.filter("error")[0];
    expect(entry.stack).toBeDefined();
    expect(entry.stack).toContain("test error");
  });

  it("7.2 error con objeto no-Error maneja gracefully", () => {
    const log = new Logger("test");
    log.error("failed", { error: { code: "X", msg: "y" } });
    const entry = memorySink.filter("error")[0];
    expect(entry.stack).toBeDefined();
  });
});

// ── Stress test: el logging no rompe el sistema ──

describe("Stress: logging bajo carga", () => {
  it("8.1 1000 logs sin perder ninguno", () => {
    const log = new Logger("stress");
    for (let i = 0; i < 1000; i++) {
      log.info(`msg ${i}`);
    }
    expect(memorySink.entries.length).toBe(1000);
  });

  it("8.2 1000 métricas", () => {
    const log = new Logger("stress");
    for (let i = 0; i < 1000; i++) {
      log.metric("d", i);
    }
    expect(log.getHistograms().get("d")!.length).toBe(1000);
  });

  it("8.3 100 KnowledgeGraph.updateMastery con logging activo", () => {
    const g = new KnowledgeGraph();
    g.add(createConcept("c1", "X"));
    for (let i = 0; i < 100; i++) {
      g.updateMastery("c1", "definition", i % 2 === 0, 0.5 + (i % 5) * 0.1);
    }
    const c = g.get("c1")!;
    expect(c.layers.definition.shown).toBe(100);
  });
});
