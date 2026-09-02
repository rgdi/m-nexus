// v0.18: SafeFlush — wrapper de saveData con UI feedback y retry.
//
// Problema: Obsidian.saveData() puede fallar (sin red, plugin corrupto, etc).
// v0.17 solo loggeaba a console, sin feedback al usuario.
//
// Solución:
//   1. Capturar errores y mostrarlos como Notice.
//   2. Retry exponencial (1s, 2s, 4s) hasta 3 intentos.
//   3. Si todo falla, encolar el save para el próximo flush.
//   4. Listener opcional para tests (no UI).

import type { PluginDataStorage } from "./persistence.js";

export interface SafeFlushOptions {
  /** Número de reintentos. Default 3. */
  maxRetries: number;
  /** Delay inicial (ms). Default 1000. */
  initialDelay: number;
  /** Factor de backoff. Default 2. */
  backoffFactor: number;
  /** Si true, muestra Notice. Default true. */
  showNotice: boolean;
  /** Logger para tests. */
  log?: (msg: string, data?: unknown) => void;
  /** Notice factory para tests. */
  showNoticeFn?: (msg: string, durationMs: number) => void;
}

const DEFAULT_OPTIONS: SafeFlushOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  backoffFactor: 2,
  showNotice: true,
};

export interface FlushResult {
  success: boolean;
  attempts: number;
  error?: Error;
  durationMs: number;
}

/** Estado de la cola de saves pendientes. */
interface PendingSave {
  triggeredAt: number;
  attempts: number;
  lastError?: string;
}

export class SafeFlush {
  private storage: PluginDataStorage;
  private options: SafeFlushOptions;
  /** Cola de saves pendientes (si flush falla, se reintenta aquí). */
  private pending: PendingSave | null = null;
  /** Resultado del último flush (para tests). */
  public lastResult: FlushResult | null = null;
  /** Listener para tests: se llama en cada flush. */
  public onFlush: ((result: FlushResult) => void) | null = null;

  constructor(storage: PluginDataStorage, options: Partial<SafeFlushOptions> = {}) {
    this.storage = storage;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** v0.19: reconfigura las opciones en runtime. */
  setOptions(options: Partial<SafeFlushOptions>): void {
    this.options = { ...this.options, ...options };
  }

  getOptions(): SafeFlushOptions {
    return { ...this.options };
  }

  /** Flush con retry y UI feedback. */
  async flush(): Promise<FlushResult> {
    const start = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        await this.storage.saveNow();
        // Éxito
        const result: FlushResult = {
          success: true,
          attempts: attempt,
          durationMs: Date.now() - start,
        };
        this.lastResult = result;
        this.pending = null;
        this.onFlush?.(result);
        if (attempt > 1) {
          this.notify(`✅ Datos guardados (intento ${attempt})`, 4000);
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.options.log?.(`[safe-flush] attempt ${attempt} failed`, { error: lastError.message });

        if (attempt < this.options.maxRetries) {
          const delay = this.options.initialDelay * Math.pow(this.options.backoffFactor, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    // Todos los intentos fallaron
    const result: FlushResult = {
      success: false,
      attempts: this.options.maxRetries,
      error: lastError ?? undefined,
      durationMs: Date.now() - start,
    };
    this.lastResult = result;
    this.pending = {
      triggeredAt: Date.now(),
      attempts: this.options.maxRetries,
      lastError: lastError?.message,
    };
    this.onFlush?.(result);
    this.notify(
      `❌ No se pudieron guardar los datos: ${lastError?.message ?? "error desconocido"}. Se reintentará al cerrar.`,
      0 // persistente
    );
    return result;
  }

  /** Indica si hay un save pendiente. */
  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Devuelve info del save pendiente. */
  getPending(): PendingSave | null {
    return this.pending ? { ...this.pending } : null;
  }

  /** Limpia el pending (después de un flush exitoso). */
  clearPending(): void {
    this.pending = null;
  }

  /** Flush garantizado en onunload: intenta hasta que funcione o hasta timeout. */
  async forceFlushOnUnload(timeoutMs: number = 5000): Promise<FlushResult> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await this.flush();
      if (result.success) return result;
      // Espera corta antes de reintentar
      await this.sleep(200);
    }
    return {
      success: false,
      attempts: this.lastResult?.attempts ?? 0,
      error: new Error("Timeout during unload"),
      durationMs: Date.now() - start,
    };
  }

  private notify(msg: string, durationMs: number): void {
    if (!this.options.showNotice) return;
    if (this.options.showNoticeFn) {
      this.options.showNoticeFn(msg, durationMs);
    } else {
      // En producción, intentar usar el Notice de Obsidian.
      // Si no está disponible (tests), loggear.
      try {
        // Lazy require para no romper tests
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Notice } = require("obsidian");
        new Notice(msg, durationMs);
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`[mnexus] ${msg}`);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
