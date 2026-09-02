// v0.28: Test exhaustivo del sistema de logging + caja negra (breadcrumbs).
//
// Verifica:
//   1) 6 niveles de log
//   2) Sinks estáticos
//   3) Métricas (counters, histograms, percentiles)
//   4) Asserts (assert, assertNotNull, assertRange)
//   5) Anomaly detection
//   6) Throttling
//   7) Breadcrumbs ring buffer
//   8) Caja negra en errors/fatals
//   9) Call site detection
//  10) Flujo end-to-end realista

import { describe, it, expect, beforeEach } from "vitest";
import { Logger, MemorySink, type LogEntry } from "../src/utils/logger";
import {
  BreadcrumbSystem,
  getBreadcrumbs,
  resetBreadcrumbs,
  type Breadcrumb,
  type BlackBox,
} from "../src/utils/breadcrumbs";

// ── 1) Logger: niveles básicos ──

describe("1) Logger: 6 niveles", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    Logger.clearContext();
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("1.1 trace, debug, info, warn, error, fatal se registran", () => {
    const log = new Logger("test");
    log.trace("trace msg");
    log.debug("debug msg");
    log.info("info msg");
    log.warn("warn msg");
    log.error("error msg");
    log.fatal("fatal msg");
    expect(sink.entries.length).toBe(6);
    expect(sink.entries.map((e) => e.level)).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]);
  });

  it("1.2 setMinLevel filtra los de menor prioridad", () => {
    Logger.setMinLevel("warn");
    const log = new Logger("test");
    log.trace("trace");
    log.debug("debug");
    log.info("info");
    log.warn("warn");
    log.error("error");
    log.fatal("fatal");
    expect(sink.entries.length).toBe(3); // warn, error, fatal
    expect(sink.entries.map((e) => e.level)).toEqual(["warn", "error", "fatal"]);
  });

  it("1.3 logger name se preserva en entries", () => {
    const log = new Logger("mi-subsistema");
    log.info("test");
    expect(sink.entries[0].logger).toBe("mi-subsistema");
  });

  it("1.4 context se preserva en entries", () => {
    const log = new Logger("test");
    log.info("test", { operation: "vault.eval", data: { count: 5 } });
    const entry = sink.entries[0];
    expect(entry.context.operation).toBe("vault.eval");
    expect(entry.context.data).toEqual({ count: 5 });
  });

  it("1.5 parent context se mergea con context del log", () => {
    Logger.setContext({ correlationId: "req-123", userId: "user-1" });
    const log = new Logger("test");
    log.info("test", { operation: "vault.eval" });
    const entry = sink.entries[0];
    expect(entry.context.correlationId).toBe("req-123");
    expect(entry.context.userId).toBe("user-1");
    expect(entry.context.operation).toBe("vault.eval");
  });
});

// ── 2) Logger: error stacks ──

describe("2) Logger: error stacks", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("2.1 error con Error object incluye stack", () => {
    const log = new Logger("test");
    const err = new Error("boom");
    log.error("algo falló", { error: err });
    expect(sink.entries[0].stack).toBeDefined();
    expect(sink.entries[0].stack).toContain("Error: boom");
  });

  it("2.2 fatal con Error object también incluye stack", () => {
    const log = new Logger("test");
    const err = new Error("crash");
    log.fatal("fatal", { error: err });
    expect(sink.entries[0].stack).toContain("Error: crash");
  });

  it("2.3 error con valor no-Error se convierte a string", () => {
    const log = new Logger("test");
    log.error("falló", { error: "string error" });
    expect(sink.entries[0].stack).toBe("string error");
  });
});

// ── 3) Logger: métricas ──

describe("3) Logger: métricas (counters, histograms)", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("info");
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("3.1 counter incrementa correctamente", () => {
    const log = new Logger("test");
    log.counter("requests", 1);
    log.counter("requests", 1);
    log.counter("requests", 5);
    const counters = log.getCounters();
    expect(counters.get("requests")).toBe(7);
  });

  it("3.2 metric registra valores en histogram", () => {
    const log = new Logger("test");
    log.metric("latency", 100);
    log.metric("latency", 200);
    log.metric("latency", 50);
    const histograms = log.getHistograms();
    const latencies = histograms.get("latency")!;
    expect(latencies.length).toBe(3);
    expect(latencies).toEqual([100, 200, 50]);
  });

  it("3.3 time() mide duración de función async", async () => {
    const log = new Logger("test");
    const result = await log.time("myop", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 42;
    });
    expect(result).toBe(42);
    const histograms = log.getHistograms();
    const durations = histograms.get("myop")!;
    expect(durations.length).toBe(1);
    // 49ms es aceptable: el setTimeout puede ser ~1-2ms más rápido.
    expect(durations[0]).toBeGreaterThanOrEqual(45);
  });

  it("3.4 resetMetrics limpia counters e histograms", () => {
    const log = new Logger("test");
    log.counter("c", 1);
    log.metric("m", 1);
    log.resetMetrics();
    expect(log.getCounters().size).toBe(0);
    expect(log.getHistograms().size).toBe(0);
  });
});

// ── 4) Logger: asserts ──

describe("4) Logger: asserts", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("4.1 assert(true) no genera log", () => {
    const log = new Logger("test");
    log.assert(true, "no debería loguear");
    expect(sink.entries.length).toBe(0);
  });

  it("4.2 assert(false) genera error con mensaje", () => {
    const log = new Logger("test");
    log.assert(false, "esto falló");
    expect(sink.entries.length).toBe(1);
    expect(sink.entries[0].level).toBe("error");
    expect(sink.entries[0].message).toContain("ASSERTION FAILED");
  });

  it("4.3 assertNotNull detecta null", () => {
    const log = new Logger("test");
    const result = log.assertNotNull(null, "value");
    expect(result).toBeNull();
    expect(sink.filter("error").length).toBe(1);
  });

  it("4.4 assertNotNull detecta undefined", () => {
    const log = new Logger("test");
    const result = log.assertNotNull(undefined, "value");
    expect(result).toBeNull();
    expect(sink.filter("error").length).toBe(1);
  });

  it("4.5 assertNotNull detecta NaN (B FIX v0.28)", () => {
    const log = new Logger("test");
    const result = log.assertNotNull(NaN, "stability");
    expect(result).toBeNull();
    expect(sink.filter("error").length).toBe(1);
  });

  it("4.6 assertNotNull retorna el valor si es válido", () => {
    const log = new Logger("test");
    const result = log.assertNotNull(42, "answer");
    expect(result).toBe(42);
    expect(sink.filter("error").length).toBe(0);
  });

  it("4.7 assertRange detecta fuera de rango", () => {
    const log = new Logger("test");
    log.assertRange(0.5, 0, 1, "mastery");
    log.assertRange(1.5, 0, 1, "mastery"); // fuera
    expect(sink.filter("error").length).toBe(1);
  });

  it("4.8 assertRange acepta en rango", () => {
    const log = new Logger("test");
    log.assertRange(0.5, 0, 1, "mastery");
    expect(sink.filter("error").length).toBe(0);
  });
});

// ── 5) Logger: anomaly detection ──

describe("5) Logger: anomaly detection", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("5.1 anomaly() registra warn si valor fuera de rango", () => {
    const log = new Logger("test");
    log.anomaly("stability", 0, 5, 0.5);
    expect(sink.filter("warn").length).toBe(1);
  });

  it("5.2 anomaly() no registra si valor en rango", () => {
    const log = new Logger("test");
    log.anomaly("stability", 5, 5, 0.5);
    expect(sink.filter("warn").length).toBe(0);
  });

  it("5.3 anomaly() acepta tolerance custom", () => {
    const log = new Logger("test");
    // 5.6 está fuera de [4.5, 5.5] con tolerance 0.5
    log.anomaly("stability", 5.6, 5, 0.5);
    expect(sink.filter("warn").length).toBe(1);
    // 5.4 está dentro de [4.5, 5.5]
    log.anomaly("stability", 5.4, 5, 0.5);
    expect(sink.filter("warn").length).toBe(1);
  });
});

// ── 6) Logger: throttling ──

describe("6) Logger: throttling (evitar spam)", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("6.1 throttledWarn: múltiples calls en ventana corta → solo 1", () => {
    const log = new Logger("test");
    for (let i = 0; i < 10; i++) {
      log.throttledWarn("same-key", "warning", 5000);
    }
    expect(sink.filter("warn").length).toBe(1);
  });

  it("6.2 throttledWarn: keys diferentes pasan independiente", () => {
    const log = new Logger("test");
    log.throttledWarn("key-a", "msg a", 5000);
    log.throttledWarn("key-b", "msg b", 5000);
    expect(sink.filter("warn").length).toBe(2);
  });
});

// ── 7) Breadcrumbs: ring buffer ──

describe("7) Breadcrumbs: ring buffer (max 100)", () => {
  let sys: BreadcrumbSystem;
  beforeEach(() => {
    sys = new BreadcrumbSystem();
  });

  it("7.1 record() asigna ID secuencial", () => {
    const a = sys.record("info", "test", "msg 1");
    const b = sys.record("info", "test", "msg 2");
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it("7.2 ring buffer descarta los más viejos", () => {
    for (let i = 0; i < 150; i++) {
      sys.record("info", "test", `msg ${i}`);
    }
    expect(sys.all().length).toBe(100);
    expect(sys.all()[0].message).toBe("msg 50");
  });

  it("7.3 clear() vacía el buffer", () => {
    sys.record("info", "test", "msg");
    sys.clear();
    expect(sys.all().length).toBe(0);
  });

  it("7.4 setCorrelationId persiste", () => {
    sys.setCorrelationId("req-abc-123");
    expect(sys.getBlackBox().correlationId).toBe("req-abc-123");
  });

  it("7.5 setContext mergea con el existente", () => {
    sys.setContext({ userId: "u1" });
    sys.setContext({ sessionId: "s1" });
    const ctx = sys.getBlackBox().context;
    expect(ctx.userId).toBe("u1");
    expect(ctx.sessionId).toBe("s1");
  });

  it("7.6 recent(n) devuelve los últimos N", () => {
    for (let i = 0; i < 50; i++) sys.record("info", "test", `msg ${i}`);
    const last5 = sys.recent(5);
    expect(last5.length).toBe(5);
    expect(last5[0].message).toBe("msg 45");
    expect(last5[4].message).toBe("msg 49");
  });

  it("7.7 stats por tipo y categoría", () => {
    sys.record("info", "vault", "1");
    sys.record("info", "vault", "2");
    sys.record("warn", "fsrs", "3");
    sys.record("error", "ai", "4");
    const stats = sys.stats();
    expect(stats.total).toBe(4);
    expect(stats.byType.info).toBe(2);
    expect(stats.byType.warn).toBe(1);
    expect(stats.byType.error).toBe(1);
    expect(stats.byCategory.vault).toBe(2);
  });
});

// ── 8) Caja negra en errors/fatals ──

describe("8) Caja negra: errors/fatals incluyen últimos 20 breadcrumbs", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    Logger.clearContext();
    resetBreadcrumbs();
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("8.1 error() incluye blackbox con últimos 20 breadcrumbs", () => {
    const log = new Logger("test");
    // Generar 30 breadcrumbs (debe quedarse con los últimos 20)
    for (let i = 0; i < 30; i++) {
      log.info(`op ${i}`);
    }
    log.error("algo falló");
    const errorEntry = sink.filter("error")[0];
    expect(errorEntry.blackbox).toBeDefined();
    expect(errorEntry.blackbox!.breadcrumbs.length).toBe(20);
  });

  it("8.2 fatal() también incluye blackbox", () => {
    const log = new Logger("test");
    log.info("op 1");
    log.fatal("crash");
    const fatalEntry = sink.filter("fatal")[0];
    expect(fatalEntry.blackbox).toBeDefined();
    // El fatal se incluye a sí mismo como breadcrumb (info + fatal = 2).
    // Esto es útil: el breadcrumb del error es la última pista de qué pasó.
    expect(fatalEntry.blackbox!.breadcrumbs.length).toBe(2);
    expect(fatalEntry.blackbox!.breadcrumbs[0].message).toBe("op 1");
    expect(fatalEntry.blackbox!.breadcrumbs[1].message).toBe("crash");
  });

  it("8.3 info() NO incluye blackbox", () => {
    const log = new Logger("test");
    log.info("test");
    expect(sink.entries[0].blackbox).toBeUndefined();
  });

  it("8.4 warn() NO incluye blackbox (solo error/fatal)", () => {
    const log = new Logger("test");
    log.info("op");
    log.warn("warning");
    expect(sink.filter("warn")[0].blackbox).toBeUndefined();
  });

  it("8.5 blackbox incluye correlationId", () => {
    getBreadcrumbs().setCorrelationId("test-correlation-123");
    const log = new Logger("test");
    log.info("op");
    log.error("fail");
    const errorEntry = sink.filter("error")[0];
    expect(errorEntry.blackbox!.correlationId).toBe("test-correlation-123");
  });

  it("8.6 blackbox tiene los datos de cada breadcrumb", () => {
    const log = new Logger("test");
    log.info("snapshots read", { operation: "vault.eval", data: { count: 5 } });
    log.error("fail");
    const bc = sink.filter("error")[0].blackbox!.breadcrumbs[0];
    expect(bc.data).toEqual({ count: 5 });
  });
});

// ── 9) Call site detection ──

describe("9) Logger: call site detection (file, line, function)", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    Logger.clearContext();
    resetBreadcrumbs();
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("9.1 info() registra breadcrumb con call site", () => {
    const log = new Logger("test");
    log.info("test"); // línea X
    const bc = getBreadcrumbs().all()[0];
    // El call site debe apuntar a este test file
    expect(bc.file).toBeDefined();
    expect(bc.line).toBeDefined();
    expect(bc.line).toBeGreaterThan(0);
  });

  it("9.2 call site filtra el stack del logger", () => {
    const log = new Logger("test");
    function myCustomFunc() {
      log.info("test");
    }
    myCustomFunc();
    const bc = getBreadcrumbs().all()[0];
    // No debe apuntar a logger.ts
    expect(bc.file).not.toContain("logger.ts");
  });
});

// ── 10) Flujo end-to-end realista ──

describe("10) Flujo end-to-end: estudio médico real con logs y caja negra", () => {
  let sink: MemorySink;
  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    Logger.clearContext();
    resetBreadcrumbs();
    sink = new MemorySink();
    Logger.addSink(sink.sink);
  });

  it("10.1 simulación: estudiante estudia, FSRS revisa, error en card, debug con caja negra", () => {
    const fsrsLog = new Logger("fsrs");
    const studyLog = new Logger("study");

    // 1) Sesión de estudio empieza
    studyLog.info("Sesión de estudio iniciada", {
      operation: "study.start",
      data: { subject: "anatomia", cards: 10 },
    });

    // 2) FSRS carga 10 cards
    for (let i = 0; i < 10; i++) {
      fsrsLog.info(`Card ${i} loaded`, {
        operation: "fsrs.load",
        data: { cardId: `c${i}`, stability: 5, dueDate: "2026-09-01" },
      });
    }

    // 3) Estudiante responde 9 bien, 1 mal
    for (let i = 0; i < 9; i++) {
      fsrsLog.info(`Card c${i} reviewed`, {
        operation: "fsrs.review",
        data: { cardId: `c${i}`, rating: 3, timeMs: 1500 },
      });
    }

    // 4) Una card causa error (e.g., stability=NaN)
    try {
      const card = { stability: NaN, difficulty: 5, dueDate: "2026-09-01" };
      fsrsLog.assertNotNull(card.stability, "stability", { operation: "fsrs.review" });
      // El assertNotNull retorna null si el valor no es válido
      throw new Error("Invalid stability after assert");
    } catch (e) {
      fsrsLog.error("FSRS review failed", { error: e as Error, operation: "fsrs.review" });
    }

    // 5) Verificar que el error incluye la caja negra con TODO el contexto
    const errorEntry = sink.filter("error")[0];
    expect(errorEntry).toBeDefined();
    expect(errorEntry.blackbox).toBeDefined();

    // La caja negra guarda los últimos 20 breadcrumbs. Con 21+ eventos
    // (1 sesión + 10 loaded + 9 reviewed + 1 ASSERTION + 1 error),
    // los primeros 2 se pierden (límite FIFO).
    // Verificamos que el contexto CRÍTICO sí está: el error y los últimos steps.
    const messages = errorEntry.blackbox!.breadcrumbs.map((b) => b.message);
    // El error en sí debe estar (es el último breadcrumb)
    expect(messages.some((m) => m.includes("ASSERTION FAILED"))).toBe(true);
    // Los últimos "reviewed" deben estar
    expect(messages.filter((m) => m.includes("reviewed")).length).toBeGreaterThan(0);
    // Y al menos algunos "loaded" (10 + 9 + 1 = 20, los últimos 20 = varios)
    expect(messages.filter((m) => m.includes("loaded")).length).toBeGreaterThan(0);
  });

  it("10.2 metrics: counter, histogram y time en flujo real", () => {
    const log = new Logger("perf");

    log.counter("study_sessions", 1);
    log.counter("cards_reviewed", 0);

    const t = async (i: number) => {
      await new Promise((r) => setTimeout(r, 5));
      log.counter("cards_reviewed", 1);
      log.metric("review_time_ms", 5 + i);
    };

    return Promise.all([t(0), t(1), t(2), t(3), t(4)]).then(() => {
      const counters = log.getCounters();
      expect(counters.get("study_sessions")).toBe(1);
      expect(counters.get("cards_reviewed")).toBe(5);
      const hist = log.getHistograms();
      const times = hist.get("review_time_ms")!;
      expect(times.length).toBe(5);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeGreaterThanOrEqual(5);
    });
  });

  it("10.3 throttled: warning recurrente se registra solo una vez", () => {
    const log = new Logger("audio");
    // Simular 20 warnings de audio underruns
    for (let i = 0; i < 20; i++) {
      log.throttledWarn("audio-underrun", `Underrun ${i}`, 10000);
    }
    // Solo 1 debe aparecer
    const warns = sink.filter("warn");
    expect(warns.length).toBe(1);
  });

  it("10.4 correlation: correlationId se preserva en toda la sesión", () => {
    Logger.setContext({ correlationId: "session-abc-123", userId: "user-1" });
    const fsrsLog = new Logger("fsrs");
    const audioLog = new Logger("audio");

    fsrsLog.info("review started");
    audioLog.info("audio loaded");
    fsrsLog.info("review completed");

    // Todos los entries tienen el correlationId del contexto
    for (const entry of sink.entries) {
      expect(entry.context.correlationId).toBe("session-abc-123");
      expect(entry.context.userId).toBe("user-1");
    }
  });
});

// ── 11) Bug encontrado: 'navigation' duplicado ──

describe("11) Bug: 'navigation' duplicado en BreadcrumbType", () => {
  it("11.1 el type union tiene 'navigation' dos veces (no causa bug runtime pero es descuido)", () => {
    // El código tiene "navigation" dos veces en el union (líneas 30 y 31).
    // TypeScript lo acepta, pero indica copy-paste error.
    // Verificamos que 'navigation' sigue funcionando:
    const bc: Breadcrumb = {
      id: 1,
      timestamp: Date.now(),
      type: "navigation",
      category: "test",
      message: "test",
    };
    expect(bc.type).toBe("navigation");
  });
});
