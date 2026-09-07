// wsRateLimit.ts: rate limiter para WebSocket connections (Fase 6 security fix).
//
// v0.46: bug del auditor #6 — el WebSocket /transcription/stream no tenia
// rate limit. Un cliente malicioso podia saturar el server con messages
// y tirar el proceso (DoS).
//
// Solución: counter por connection que se resetea cada ventana temporal.
// Si supera el limite, cierra el socket con code 1008 (policy violation).
// Config:
//   - WS_RATE_LIMIT_MESSAGES: max mensajes por ventana (default 100)
//   - WS_RATE_LIMIT_BYTES: max bytes recibidos por ventana (default 10MB)
//   - WS_RATE_LIMIT_WINDOW_MS: tamaño de la ventana (default 60000 = 1 min)
//   - WS_MAX_CONCURRENT: max conexiones concurrentes por deviceId (default 5)

export interface WSRateLimitConfig {
  maxMessages: number;
  maxBytes: number;
  windowMs: number;
  maxConcurrentPerDevice: number;
}

export function getWSRateLimitConfig(): WSRateLimitConfig {
  return {
    maxMessages: parseInt(process.env.WS_RATE_LIMIT_MESSAGES ?? "100", 10),
    maxBytes: parseInt(process.env.WS_RATE_LIMIT_BYTES ?? `${10 * 1024 * 1024}`, 10), // 10MB
    windowMs: parseInt(process.env.WS_RATE_LIMIT_WINDOW_MS ?? "60000", 10), // 1 min
    maxConcurrentPerDevice: parseInt(process.env.WS_MAX_CONCURRENT ?? "5", 10),
  };
}

export interface RateLimitState {
  messagesInWindow: number;
  bytesInWindow: number;
  windowStartMs: number;
}

/**
 * Crea un rate limit tracker para una connection.
 * Reset sliding window: cada windowMs los counters vuelven a 0.
 */
export function createRateLimitTracker(): RateLimitState {
  const now = Date.now();
  return {
    messagesInWindow: 0,
    bytesInWindow: 0,
    windowStartMs: now,
  };
}

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; reason: "messages" | "bytes"; limit: number; used: number; resetMs: number };

/**
 * Evalúa si un message está permitido bajo el rate limit.
 * Si la ventana expiró, resetea counters y permite.
 */
export function checkRateLimit(
  state: RateLimitState,
  bytes: number,
  config: WSRateLimitConfig
): RateLimitVerdict {
  const now = Date.now();
  if (now - state.windowStartMs >= config.windowMs) {
    state.messagesInWindow = 0;
    state.bytesInWindow = 0;
    state.windowStartMs = now;
  }
  state.messagesInWindow++;
  state.bytesInWindow += bytes;

  if (state.messagesInWindow > config.maxMessages) {
    return {
      allowed: false,
      reason: "messages",
      limit: config.maxMessages,
      used: state.messagesInWindow,
      resetMs: config.windowMs - (now - state.windowStartMs),
    };
  }
  if (state.bytesInWindow > config.maxBytes) {
    return {
      allowed: false,
      reason: "bytes",
      limit: config.maxBytes,
      used: state.bytesInWindow,
      resetMs: config.windowMs - (now - state.windowStartMs),
    };
  }
  return { allowed: true };
}

/**
 * Track global de conexiones concurrentes por deviceId.
 * Evita que un solo deviceId monopolice el server con miles de sockets.
 */
export class ConcurrentConnectionTracker {
  private byDevice: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Auto-cleanup cada 5 minutos para evitar leak si un socket se cierra sin disparar el close handler
    this.cleanupInterval = setInterval(() => {
      // No removemos entries explícitamente: increment/decrement mantiene consistencia
      // Solo limpiamos devices con 0 (que no deberían existir, pero por seguridad)
      for (const [k, v] of this.byDevice) {
        if (v <= 0) this.byDevice.delete(k);
      }
    }, 5 * 60 * 1000);
  }

  canConnect(deviceId: string, maxPerDevice: number): boolean {
    const current = this.byDevice.get(deviceId) ?? 0;
    return current < maxPerDevice;
  }

  increment(deviceId: string): void {
    this.byDevice.set(deviceId, (this.byDevice.get(deviceId) ?? 0) + 1);
  }

  decrement(deviceId: string): void {
    const current = this.byDevice.get(deviceId) ?? 0;
    if (current <= 1) {
      this.byDevice.delete(deviceId);
    } else {
      this.byDevice.set(deviceId, current - 1);
    }
  }

  getCurrent(deviceId: string): number {
    return this.byDevice.get(deviceId) ?? 0;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.byDevice.clear();
  }
}
