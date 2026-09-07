// SafeCall: helpers de try-catch con logging automático para el backend.
// Espejo del app/lib/utils/safe_call.dart.
//
// Uso:
//   const r = await safeCallAsync({
//     component: "auth", code: "EC-AUTH-001", message: "login failed",
//     op: () => verifyCredentials(token),
//   });
//   if (r.success) sendOk(res, r.value);
//   else sendError(res, r.error);

import type { AppError } from "./errorCodes.js";
import { logger } from "./log.js";

export interface SafeResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly error?: AppError;
  readonly durationMs: number;
}

interface SafeCallOptions {
  component: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
  hint?: string;
  throwOnError?: boolean;
  statusCode?: number;
}

function buildSafeResult<T>(
  startTime: number,
  success: boolean,
  value?: T,
  error?: AppError,
): SafeResult<T> {
  return {
    success,
    value,
    error,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Envuelve una operación async con logging automático.
 * Retorna SafeResult con success/value/error/durationMs.
 * Si throwOnError=true, lanza el AppError en vez de retornarlo.
 */
export async function safeCallAsync<T>(
  opts: SafeCallOptions & { op: () => Promise<T> },
): Promise<SafeResult<T>> {
  const startTime = Date.now();
  const ctx = opts.context ?? {};
  logger.debug({ component: opts.component, code: opts.code, ...ctx }, `→ ${opts.message}`);
  try {
    const value = await opts.op();
    const durationMs = Date.now() - startTime;
    logger.debug({ component: opts.component, code: opts.code, durationMs, ...ctx }, `← OK ${opts.message}`);
    if (opts.throwOnError) return buildSafeResult(startTime, true, value);
    return buildSafeResult(startTime, true, value);
  } catch (err) {
    const error = normalizeError(err, opts);
    logError(error, startTime, ctx);
    if (opts.throwOnError) throw (err instanceof Error ? err : error);
    return buildSafeResult<T>(startTime, false, undefined, error);
  }
}

/**
 * Versión sync.
 */
export function safeCall<T>(
  opts: SafeCallOptions & { op: () => T },
): SafeResult<T> {
  const startTime = Date.now();
  const ctx = opts.context ?? {};
  logger.debug({ component: opts.component, code: opts.code, ...ctx }, `→ ${opts.message}`);
  try {
    const value = opts.op();
    const durationMs = Date.now() - startTime;
    logger.debug({ component: opts.component, code: opts.code, durationMs, ...ctx }, `← OK ${opts.message}`);
    return buildSafeResult(startTime, true, value);
  } catch (err) {
    const error = normalizeError(err, opts);
    logError(error, startTime, ctx);
    if (opts.throwOnError) throw (err instanceof Error ? err : error);
    return buildSafeResult<T>(startTime, false, undefined, error);
  }
}

/**
 * Versión "ignorar error" — retorna undefined en error.
 */
export async function safeCallOrNull<T>(
  opts: SafeCallOptions & { op: () => Promise<T> },
): Promise<T | undefined> {
  const r = await safeCallAsync(opts);
  return r.value;
}

/**
 * Versión sync "ignorar error".
 */
export function safeCallOrNullSync<T>(
  opts: SafeCallOptions & { op: () => T },
): T | undefined {
  const r = safeCall(opts);
  return r.value;
}

/**
 * Wrap un error genérico como AppError. Útil para re-throw.
 */
export function wrapError(
  err: unknown,
  opts: SafeCallOptions,
): AppError {
  return normalizeError(err, opts);
}

// ── Internals ───────────────────────────────────────────
import { AppError as AppErrorClass, ErrorCategory } from "./errorCodes.js";

function normalizeError(err: unknown, opts: SafeCallOptions): AppErrorClass {
  if (err instanceof AppErrorClass) return err;
  if (err instanceof Error) {
    return new AppErrorClass({
      category: guessCategoryFromComponent(opts.component),
      code: opts.code,
      message: opts.message,
      cause: err,
      context: opts.context,
      hint: opts.hint,
      statusCode: opts.statusCode,
    });
  }
  return new AppErrorClass({
    category: ErrorCategory.INTERNAL,
    code: opts.code,
    message: `${opts.message}: ${String(err)}`,
    context: { ...opts.context, raw: String(err) },
    hint: opts.hint,
    statusCode: opts.statusCode,
  });
}

function guessCategoryFromComponent(component: string): ErrorCategory {
  // Heurística simple: matching por prefijo
  const c = component.toLowerCase();
  if (c.includes("auth") || c.includes("jwt")) return ErrorCategory.AUTH;
  if (c.includes("db") || c.includes("sqlite") || c.includes("query")) return ErrorCategory.DB;
  if (c.includes("fs") || c.includes("file") || c.includes("vault") || c.includes("backup")) return ErrorCategory.FS;
  if (c.includes("net") || c.includes("http") || c.includes("fetch")) return ErrorCategory.NET;
  if (c.includes("llm") || c.includes("ollama") || c.includes("openrouter")) return ErrorCategory.LLM;
  if (c.includes("ocr") || c.includes("deepseek") || c.includes("tesseract")) return ErrorCategory.OCR;
  if (c.includes("whisper") || c.includes("audio") || c.includes("transcrib")) return ErrorCategory.AUD;
  if (c.includes("embed") || c.includes("vector")) return ErrorCategory.EMB;
  if (c.includes("secret") || c.includes("encrypt")) return ErrorCategory.SEC;
  if (c.includes("sync") || c.includes("lww") || c.includes("vectorclock")) return ErrorCategory.SYNC;
  if (c.includes("conflict")) return ErrorCategory.CONFL;
  if (c.includes("proposal")) return ErrorCategory.PROP;
  if (c.includes("push") || c.includes("notif")) return ErrorCategory.PUSH;
  if (c.includes("quiz") || c.includes("adaptive")) return ErrorCategory.QUIZ;
  if (c.includes("structured") || c.includes("datab") || c.includes("row")) return ErrorCategory.STR;
  if (c.includes("relevance") || c.includes("cross")) return ErrorCategory.REL;
  if (c.includes("ws") || c.includes("websocket")) return ErrorCategory.WS;
  if (c.includes("rate") || c.includes("limit")) return ErrorCategory.RATE;
  if (c.includes("config") || c.includes("setup")) return ErrorCategory.CFG;
  if (c.includes("eval") || c.includes("search")) return ErrorCategory.EVAL;
  if (c.includes("lifecycle") || c.includes("init") || c.includes("startup")) return ErrorCategory.LIFECYCLE;
  return ErrorCategory.INTERNAL;
}

function logError(error: AppErrorClass, startTime: number, ctx: Record<string, unknown>): void {
  const durationMs = Date.now() - startTime;
  logger.error({
    component: error.category.toLowerCase(),
    code: error.code,
    category: error.category,
    message: error.message,
    cause: error.cause?.message,
    context: { ...ctx, ...error.context },
    hint: error.hint,
    durationMs,
    timestamp: error.timestamp.toISOString(),
    stack: error.stack,
  }, `[${error.code}] ${error.message}`);
}
