// v0.28: Sistema de caja negra (breadcrumbs).
//
// Cada operación queda registrada con un breadcrumb que incluye:
//   - timestamp
//   - tipo (info, debug, warn, error, action, state, http, fsrs, knowledge)
//   - categoría (qué subsistema)
//   - mensaje
//   - data (variables relevantes)
//   - call site (función, archivo, línea)
//   - duración si aplica
//
// Cuando se registra un error o fatal, los últimos N breadcrumbs se incluyen
// automáticamente en el context (caja negra para debugging).
//
// Ring buffer circular: máximo 100 breadcrumbs por defecto, los más viejos se descartan.

export type BreadcrumbType =
  | "info"
  | "debug"
  | "trace"
  | "warn"
  | "error"
  | "fatal"
  | "action"     // acción del usuario
  | "state"      // cambio de estado
  | "http"       // llamada HTTP
  | "fsrs"       // review FSRS
  | "knowledge"  // knowledge graph update
  | "audio"      // audio processing
  | "ocr"        // OCR
  | "navigation" // navigation event
  | "user"       // user input
  | "system";    // system event

export interface Breadcrumb {
  /** ID único secuencial. */
  id: number;
  /** Timestamp en ms. */
  timestamp: number;
  /** Tipo de evento. */
  type: BreadcrumbType;
  /** Categoría (subsistema). */
  category: string;
  /** Mensaje descriptivo. */
  message: string;
  /** Datos estructurados (variables, args, etc.). */
  data?: Record<string, unknown>;
  /** Función que emitió este breadcrumb. */
  function?: string;
  /** Archivo (opcional). */
  file?: string;
  /** Línea (opcional). */
  line?: number;
  /** Duración en ms (si aplica). */
  durationMs?: number;
}

export interface BlackBox {
  /** Breadcrumbs en orden cronológico. */
  breadcrumbs: Breadcrumb[];
  /** ID correlacionado (si aplica). */
  correlationId?: string;
  /** Contexto global (user, session, etc.). */
  context: Record<string, unknown>;
  /** Timestamp de creación. */
  createdAt: number;
}

const MAX_BREADCRUMBS = 100;

export class BreadcrumbSystem {
  private buffer: Breadcrumb[] = [];
  private nextId = 1;
  private correlationId?: string;
  private globalContext: Record<string, unknown> = {};
  private startTime = Date.now();

  /**
   * Registra un breadcrumb. Si se excede el límite, los más viejos se eliminan.
   */
  record(
    type: BreadcrumbType,
    category: string,
    message: string,
    options?: {
      data?: Record<string, unknown>;
      function?: string;
      file?: string;
      line?: number;
      durationMs?: number;
    },
  ): Breadcrumb {
    const bc: Breadcrumb = {
      id: this.nextId++,
      timestamp: Date.now(),
      type,
      category,
      message,
      data: options?.data,
      function: options?.function,
      file: options?.file,
      line: options?.line,
      durationMs: options?.durationMs,
    };
    this.buffer.push(bc);
    // Ring buffer: descarta los más viejos si excede el límite
    while (this.buffer.length > MAX_BREADCRUMBS) {
      this.buffer.shift();
    }
    return bc;
  }

  /** Devuelve los últimos N breadcrumbs. */
  recent(n: number = 20): Breadcrumb[] {
    return this.buffer.slice(-n);
  }

  /** Devuelve TODOS los breadcrumbs. */
  all(): Breadcrumb[] {
    return [...this.buffer];
  }

  /** Limpia el buffer. */
  clear(): void {
    this.buffer = [];
  }

  /** Establece correlation ID. */
  setCorrelationId(id: string | undefined): void {
    this.correlationId = id;
  }

  /** Establece contexto global (user, session, etc.). */
  setContext(ctx: Record<string, unknown>): void {
    this.globalContext = { ...this.globalContext, ...ctx };
  }

  /** Devuelve la caja negra completa. */
  getBlackBox(): BlackBox {
    return {
      breadcrumbs: [...this.buffer],
      correlationId: this.correlationId,
      context: { ...this.globalContext },
      createdAt: this.startTime,
    };
  }

  /** Estadísticas de breadcrumbs. */
  stats(): { total: number; byType: Record<string, number>; byCategory: Record<string, number> } {
    const byType: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const bc of this.buffer) {
      byType[bc.type] = (byType[bc.type] ?? 0) + 1;
      byCategory[bc.category] = (byCategory[bc.category] ?? 0) + 1;
    }
    return { total: this.buffer.length, byType, byCategory };
  }
}

// Singleton global
let _global: BreadcrumbSystem | null = null;

export function getBreadcrumbs(): BreadcrumbSystem {
  if (!_global) _global = new BreadcrumbSystem();
  return _global;
}

export function resetBreadcrumbs(): void {
  _global = null;
}
