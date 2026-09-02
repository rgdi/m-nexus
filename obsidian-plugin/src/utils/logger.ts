// v0.28: Sistema de logging exhaustivo con caja negra (breadcrumbs).
//
// Características:
//   1) Niveles: TRACE, DEBUG, INFO, WARN, ERROR, FATAL
//   2) Contexto: correlationId, userId, operation, data
//   3) Structured logging: cada log es un objeto JSON
//   4) Métricas: counts, durations (en logger.metrics)
//   5) Detección de anomalías: asserts y sanity checks
//   6) Sink configurable: console, file, remote
//   7) Stack traces para errors
//   8) Throttling para evitar spam
//   9) **Caja negra**: los últimos N breadcrumbs se incluyen en errors/fatals
//
// Uso:
//   const log = new Logger("vault-eval");
//   log.info("Starting evaluation", { snapshots: 10 });
//   log.metric("vault_eval_duration_ms", 234);
//   log.assert(snapshots.length > 0, "vault vacío");
//   log.error("FSRS review failed", { error, cardId });
//   // ↑ esto incluye los últimos 20 breadcrumbs automáticamente

import { getBreadcrumbs, type BreadcrumbType } from "./breadcrumbs";

// ── Tipos ─────────────────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LogContext {
  /** ID único para correlacionar logs de la misma operación. */
  correlationId?: string;
  /** ID del usuario (si aplica). */
  userId?: string;
  /** Nombre de la operación (ej. "vault.eval", "fsrs.review"). */
  operation?: string;
  /** Datos estructurados adicionales. */
  data?: Record<string, unknown>;
  /** Campos extra planos (legacy): se mergean con `data` automáticamente. */
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  logger: string;
  message: string;
  context: LogContext;
  /** Stack trace (solo para errors). */
  stack?: string;
  /** Duración en ms (si se midió). */
  durationMs?: number;
  /** Caja negra: últimos N breadcrumbs antes de este log. */
  blackbox?: {
    breadcrumbs: Array<{
      id: number;
      timestamp: number;
      type: string;
      category: string;
      message: string;
      data?: Record<string, unknown>;
      function?: string;
      file?: string;
      line?: number;
      durationMs?: number;
    }>;
    correlationId?: string;
  };
}

export type LogSink = (entry: LogEntry) => void | Promise<void>;

// ── Logger principal ─────────────────────────────────────

export class Logger {
  private startTime = Date.now();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private throttleMap: Map<string, number> = new Map();
  /** Lista de sinks activos (accesible para inicialización en módulo). */
  static sinks: LogSink[] = [];
  private static globalMinLevel: LogLevel = "info";
  private static parentContext: LogContext = {};

  constructor(public readonly name: string = "mnexus") {}

  // ── Configuración global ──

  /** Añade un sink (consola, archivo, remoto, etc.). */
  static addSink(sink: LogSink): void {
    Logger.sinks.push(sink);
  }

  /** Elimina todos los sinks (útil para tests). */
  static clearSinks(): void {
    Logger.sinks = [];
  }

  /** Establece el nivel mínimo global. */
  static setMinLevel(level: LogLevel): void {
    Logger.globalMinLevel = level;
  }

  /** Establece contexto global (ej. userId, correlationId).
   *  Si `correlationId` está presente, también lo propaga al sistema de
   *  breadcrumbs para que la caja negra lo incluya.
   */
  static setContext(ctx: LogContext): void {
    Logger.parentContext = { ...Logger.parentContext, ...ctx };
    if (ctx.correlationId !== undefined) {
      getBreadcrumbs().setCorrelationId(ctx.correlationId);
    }
  }

  static clearContext(): void {
    Logger.parentContext = {};
  }

  /** Devuelve contadores para inspección (métricas). */
  getCounters(): Map<string, number> {
    return new Map(this.counters);
  }

  /** Devuelve histogramas (p50, p95, etc.) */
  getHistograms(): Map<string, number[]> {
    return new Map(this.histograms);
  }

  /** Resetea métricas (útil para tests). */
  resetMetrics(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  // ── Métodos de logging ──

  trace(message: string, context?: LogContext): void {
    this.log("trace", message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: LogContext & { error?: Error | unknown }): void {
    let stack: string | undefined;
    if (context?.error instanceof Error) {
      stack = context.error.stack;
    } else if (context?.error) {
      try {
        stack = String(context.error);
      } catch {
        stack = "Unstringifiable error";
      }
    }
    this.log("error", message, context, stack);
  }

  fatal(message: string, context?: LogContext & { error?: Error | unknown }): void {
    let stack: string | undefined;
    if (context?.error instanceof Error) {
      stack = context.error.stack;
    }
    this.log("fatal", message, context, stack);
  }

  // ── Métricas ──

  /** Incrementa un contador. */
  counter(name: string, value: number = 1, context?: LogContext): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
    if (Logger.shouldLog("debug")) {
      this.log("debug", `counter:${name}=${value}`, context);
    }
  }

  /** Registra una duración (ms) y la loguea como métrica. */
  metric(name: string, value: number, context?: LogContext): void {
    if (!this.histograms.has(name)) this.histograms.set(name, []);
    this.histograms.get(name)!.push(value);
    if (Logger.shouldLog("debug")) {
      this.log("debug", `metric:${name}=${value}`, context);
    }
  }

  /** Mide el tiempo de una función. */
  async time<T>(name: string, fn: () => Promise<T>, context?: LogContext): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = performance.now() - start;
      this.metric(name, durationMs, context);
      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      this.metric(name, durationMs, { ...context, error: err });
      throw err;
    }
  }

  // ── Asserts (detectan bugs) ──

  /** Assert: si la condición es falsa, registra un error. Retorna si pasó. */
  assert(condition: boolean, message: string, context?: LogContext): boolean {
    if (!condition) {
      this.error(`ASSERTION FAILED: ${message}`, context);
      return false;
    }
    return true;
  }

  /** Assert no-null/undefined. Para números también detecta NaN. */
  assertNotNull<T>(value: T | null | undefined, name: string, context?: LogContext): T | null {
    if (value === null || value === undefined) {
      this.error(`ASSERTION FAILED: ${name} is null/undefined`, context);
      return null;
    }
    // Para números, también detectar NaN
    if (typeof value === "number" && !Number.isFinite(value)) {
      this.error(`ASSERTION FAILED: ${name} is not finite (${value})`, context);
      return null;
    }
    return value;
  }

  /** Assert en un rango numérico. */
  assertRange(value: number, min: number, max: number, name: string, context?: LogContext): boolean {
    if (value < min || value > max) {
      this.error(`ASSERTION FAILED: ${name}=${value} not in [${min}, ${max}]`, context);
      return false;
    }
    return true;
  }

  // ── Throttling (evitar spam) ──

  /** Log throttled: solo emite 1 vez cada `intervalMs`. */
  throttledWarn(key: string, message: string, intervalMs: number = 5000, context?: LogContext): void {
    const last = this.throttleMap.get(key) ?? 0;
    if (Date.now() - last < intervalMs) return;
    this.throttleMap.set(key, Date.now());
    this.warn(message, context);
  }

  // ── Detección de anomalías ──

  /** Detecta un valor anómalo y lo reporta. */
  anomaly(name: string, value: number, expected: number, tolerance: number, context?: LogContext): void {
    if (Math.abs(value - expected) > tolerance) {
      this.warn(`anomaly: ${name}=${value} (expected ~${expected} ±${tolerance})`, context);
    }
  }

  // ── Internals ──

  private log(level: LogLevel, message: string, context?: LogContext, stack?: string): void {
    if (!Logger.shouldLog(level)) return;

    // Registrar breadcrumb en el sistema de caja negra
    const bc = getBreadcrumbs();
    // Mapear LogLevel a BreadcrumbType. error/fatal → "error", warn → "warn",
    // el resto se mantiene (trace/debug/info).
    const bcType: BreadcrumbType =
      level === "fatal" ? "fatal" :
      level === "error" ? "error" :
      level;
    const stackInfo = this.getCallSite();
    bc.record(bcType, this.name, message, {
      data: context?.data,
      function: stackInfo.function,
      file: stackInfo.file,
      line: stackInfo.line,
    });

    // Para errors/fatals, incluir la caja negra (últimos 20 breadcrumbs)
    let blackbox: LogEntry["blackbox"];
    if (level === "error" || level === "fatal") {
      const box = bc.getBlackBox();
      blackbox = {
        breadcrumbs: box.breadcrumbs.slice(-20).map((b) => ({
          id: b.id,
          timestamp: b.timestamp,
          type: b.type,
          category: b.category,
          message: b.message,
          data: b.data,
          function: b.function,
          file: b.file,
          line: b.line,
          durationMs: b.durationMs,
        })),
        correlationId: box.correlationId,
      };
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      logger: this.name,
      message,
      context: { ...Logger.parentContext, ...context },
      stack,
      blackbox,
    };
    for (const sink of Logger.sinks) {
      try {
        const result = sink(entry);
        if (result instanceof Promise) {
          result.catch((e) => console.error("[logger] sink error:", e));
        }
      } catch (e) {
        console.error("[logger] sink threw:", e);
      }
    }
  }

  /** Extrae información del call site usando new Error().stack. */
  private getCallSite(): { function?: string; file?: string; line?: number } {
    try {
      const stack = new Error().stack;
      if (!stack) return {};
      const lines = stack.split("\n");
      // Buscar la primera línea que no sea del logger
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("logger.ts") || line.includes("getCallSite")) continue;
        // Formato típico: "at FunctionName (file:line:col)"
        const match = line.match(/at\s+(.+?)\s+\((.+):(\d+):(\d+)\)/);
        if (match) {
          return { function: match[1], file: match[2], line: parseInt(match[3], 10) };
        }
        // Formato alternativo: "at file:line:col"
        const altMatch = line.match(/at\s+(.+):(\d+):(\d+)/);
        if (altMatch) {
          return { file: altMatch[1], line: parseInt(altMatch[2], 10) };
        }
      }
    } catch {
      // Ignore
    }
    return {};
  }

  private static shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[Logger.globalMinLevel];
  }
}

// ── Sinks predefinidos ───────────────────────────────────

/** Sink a consola con colores básicos. */
export const consoleSink: LogSink = (entry) => {
  const ts = new Date(entry.timestamp).toISOString();
  const prefix = `[${ts}] [${entry.level.toUpperCase()}] [${entry.logger}]`;
  const ctxStr = Object.keys(entry.context).length > 0
    ? ` ${JSON.stringify(entry.context)}`
    : "";
  const line = `${prefix} ${entry.message}${ctxStr}`;
  if (entry.level === "error" || entry.level === "fatal") {
    console.error(line);
    if (entry.stack) console.error(entry.stack);
  } else if (entry.level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

/** Sink a buffer en memoria (útil para tests). */
export class MemorySink {
  entries: LogEntry[] = [];
  sink: LogSink = (entry) => {
    this.entries.push(entry);
  };
  clear(): void {
    this.entries = [];
  }
  /** Filtra entradas por nivel. */
  filter(level: LogLevel): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }
  /** Cuenta errores. */
  errorCount(): number {
    return this.filter("error").length + this.filter("fatal").length;
  }
  /** Busca entradas con mensaje que contenga un substring. */
  find(substring: string): LogEntry[] {
    return this.entries.filter((e) => e.message.includes(substring));
  }
}

// ── Inicialización por defecto ────────────────────────────

if (typeof console !== "undefined" && !Logger.sinks.length) {
  Logger.addSink(consoleSink);
}
