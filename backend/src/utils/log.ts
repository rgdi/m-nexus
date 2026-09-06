// Logger estructurado para el backend M-NEXUS.
// Usa pino con formato JSON para fácil agregación.
//
// Cada log incluye:
//   - component (auth, db, llm, etc)
//   - code (EC-XXX-NNN si es error)
//   - category
//   - message
//   - context (metadata)
//   - durationMs (si aplica)
//   - stack (si hay error)
//   - hint (si aplica)

import pino, { type LoggerOptions } from "pino";

const isProduction = process.env.NODE_ENV === "production";

const config: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  
  // Formato compacto pero estructurado
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  
  // Timestamp ISO-8601
  timestamp: pino.stdTimeFunctions.isoTime,
  
  // Incluir pid/hostname solo en dev
  base: isProduction ? undefined : { pid: process.pid },
  
  // Redact common secrets
  redact: {
    paths: [
      "*.password", "*.token", "*.secret", "*.apiKey",
      "headers.authorization", "headers.cookie",
      "req.headers.authorization", "req.headers.cookie",
    ],
    censor: "[REDACTED]",
  },
  
  // Custom: agrega requestId, sessionId si están en contexto
  mixin: (mergeObject: object) => {
    const mo = mergeObject as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (mo.requestId) out.requestId = mo.requestId;
    if (mo.userId) out.userId = mo.userId;
    if (mo.sessionId) out.sessionId = mo.sessionId;
    return out;
  },
};

export const logger = pino(config);

// Helper: crea un child logger con contexto fijo
export function childLogger(component: string, extra: Record<string, unknown> = {}): pino.Logger {
  return logger.child({ component, ...extra });
}

// Helper: log de un error estructurado
export interface ErrorLog {
  code: string;
  category: string;
  message: string;
  cause?: string;
  context?: Record<string, unknown>;
  hint?: string;
  durationMs?: number;
  stack?: string;
  timestamp?: string;
}

export function logError(component: string, errorLog: ErrorLog): void {
  logger.error({ component, ...errorLog }, `[${errorLog.code}] ${errorLog.message}`);
}

export function logOp(component: string, op: string, success = true, context?: Record<string, unknown>, error?: unknown): void {
  if (success) {
    logger.debug({ component, ...context }, `op: ${op}`);
  } else {
    logger.error({ component, ...context, error: error instanceof Error ? error.message : String(error) }, `op: ${op} FAILED`);
  }
}

export function logNetwork(method: string, url: string, opts: { statusCode?: number; durationMs?: number; error?: string; requestBytes?: number; responseBytes?: number } = {}): void {
  logger.info({ component: "http", method, url, ...opts }, `${method} ${url}`);
}

export function logLifecycle(service: string, event: string, context?: Record<string, unknown>): void {
  logger.info({ component: "lifecycle", service, event, ...context }, `${service}.${event}`);
}

export function logPlatform(channel: string, method: string, success = true, error?: unknown): void {
  if (success) {
    logger.debug({ component: "plat", channel, method }, `PLAT ${channel}.${method} ok`);
  } else {
    logger.error({ component: "plat", channel, method, error: error instanceof Error ? error.message : String(error) }, `PLAT ${channel}.${method} failed`);
  }
}
