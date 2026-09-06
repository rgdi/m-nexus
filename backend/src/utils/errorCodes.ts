// ErrorCodes: códigos de error categorizados para el backend M-NEXUS.
// 
// Espejo del sistema de la app Flutter para mantener consistencia.
// Ver docs/ERROR_CODES.md para la lista completa.
//
// Formato: EC-{CATEGORÍA}-{NNN}
// Mismo namespace que la app (categoría = 3 letras).
// Rango backend: BE-NNN (BE-001, etc) o EC-{CAT}-BN-NNN
// Para simplificar, usamos el mismo formato: EC-{CAT}-NNN
// (la categoría indica si es frontend o backend).

export enum ErrorCategory {
  NET = "NET",            // Network/HTTP
  FS = "FS",              // Filesystem
  DB = "DB",              // Database
  AUTH = "AUTH",          // Auth/permissions
  CARD = "CARD",          // Flashcards
  VAL = "VAL",            // Validation (input)
  EXT = "EXT",            // External service (Ollama, OpenRouter, Whisper, etc)
  LLM = "LLM",            // LLM-specific
  OCR = "OCR",            // OCR-specific
  AUD = "AUD",            // Audio/Whisper
  EMB = "EMB",            // Embeddings
  SEC = "SEC",            // Secrets/encryption
  BK = "BK",              // Backup/restore
  SYNC = "SYNC",          // Sync (LWW, vector clocks)
  CONFL = "CONFL",        // Conflict resolution
  PROP = "PROP",          // Proposals
  PUSH = "PUSH",          // Push notifications
  QUIZ = "QUIZ",          // Adaptive quiz
  STR = "STR",            // Structured notes
  REL = "REL",            // Cross-relevance
  WS = "WS",              // WebSocket
  RATE = "RATE",          // Rate limiting
  CFG = "CFG",            // Configuration
  UP = "UP",              // Update/upgrade
  EVAL = "EVAL",          // Vault eval (search)
  LIFECYCLE = "LIFECYCLE",// Service init/dispose
  INTERNAL = "INTERNAL",  // Internal bugs/asserts
}

export const ErrorCategoryDescriptions: Record<ErrorCategory, string> = {
  [ErrorCategory.NET]: "Network/HTTP errors (fetch, http calls)",
  [ErrorCategory.FS]: "Filesystem errors (read, write, delete)",
  [ErrorCategory.DB]: "Database errors (sqlite, queries)",
  [ErrorCategory.AUTH]: "Auth/permission errors (jwt, devices)",
  [ErrorCategory.CARD]: "Flashcard errors (create, delete, FSRS)",
  [ErrorCategory.VAL]: "Validation errors (input, schema)",
  [ErrorCategory.EXT]: "External service errors (any upstream)",
  [ErrorCategory.LLM]: "LLM-specific errors (Ollama, OpenRouter)",
  [ErrorCategory.OCR]: "OCR-specific errors (Deepseek, Tesseract)",
  [ErrorCategory.AUD]: "Audio/Whisper errors",
  [ErrorCategory.EMB]: "Embeddings errors",
  [ErrorCategory.SEC]: "Secrets/encryption errors",
  [ErrorCategory.BK]: "Backup/restore errors",
  [ErrorCategory.SYNC]: "Sync errors (LWW, vector clocks)",
  [ErrorCategory.CONFL]: "Conflict resolution errors",
  [ErrorCategory.PROP]: "Proposals errors",
  [ErrorCategory.PUSH]: "Push notification errors",
  [ErrorCategory.QUIZ]: "Adaptive quiz errors",
  [ErrorCategory.STR]: "Structured notes errors",
  [ErrorCategory.REL]: "Cross-relevance errors",
  [ErrorCategory.WS]: "WebSocket errors",
  [ErrorCategory.RATE]: "Rate limiting errors",
  [ErrorCategory.CFG]: "Configuration errors",
  [ErrorCategory.UP]: "Update/upgrade errors",
  [ErrorCategory.EVAL]: "Vault evaluation (search) errors",
  [ErrorCategory.LIFECYCLE]: "Service init/dispose errors",
  [ErrorCategory.INTERNAL]: "Internal bugs/asserts",
};

/**
 * AppError: error estructurado con código identificable.
 * 
 * Cada error debe usar uno de los códigos EC-XXX-NNN para facilitar
 * filtrado en logs y debugging.
 */
export interface ErrorOptions {
  cause?: Error;
  context?: Record<string, unknown>;
  hint?: string;
  statusCode?: number;
}

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly cause?: Error;
  readonly context: Record<string, unknown>;
  readonly timestamp: Date;
  readonly hint?: string;
  readonly statusCode: number;
  
  constructor(opts: {
    category: ErrorCategory;
    code: string;
    message: string;
    cause?: Error;
    context?: Record<string, unknown>;
    hint?: string;
    statusCode?: number;
  }) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.category = opts.category;
    this.cause = opts.cause;
    this.context = opts.context ?? {};
    this.hint = opts.hint;
    this.timestamp = new Date();
    // Default status codes por categoría
    this.statusCode = opts.statusCode ?? defaultStatusCode(opts.category);
  }
  
  toString(): string {
    const buf: string[] = [`[${this.code}] ${this.message}`];
    if (this.hint) buf.push(`  hint: ${this.hint}`);
    if (this.cause) buf.push(`  cause: ${this.cause.message}`);
    if (Object.keys(this.context).length > 0) buf.push(`  context: ${JSON.stringify(this.context)}`);
    return buf.join("\n");
  }
  
  toJson(): Record<string, unknown> {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      cause: this.cause?.message,
      context: this.context,
      hint: this.hint,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

function defaultStatusCode(category: ErrorCategory): number {
  switch (category) {
    case ErrorCategory.AUTH: return 401;
    case ErrorCategory.VAL: return 400;
    case ErrorCategory.RATE: return 429;
    case ErrorCategory.DB:
    case ErrorCategory.SEC: return 403;
    case ErrorCategory.NET:
    case ErrorCategory.EXT:
    case ErrorCategory.LLM:
    case ErrorCategory.OCR:
    case ErrorCategory.AUD:
    case ErrorCategory.EMB: return 502;
    default: return 500;
  }
}

// ── Constructores semánticos ───────────────────────────────────
export const E = {
  net: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.NET, code, message, ...opts }),

  fs: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.FS, code, message, ...opts }),

  db: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.DB, code, message, ...opts }),

  auth: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.AUTH, code, message, ...opts }),

  card: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.CARD, code, message, ...opts }),

  val: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.VAL, code, message, ...opts }),

  ext: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.EXT, code, message, ...opts }),

  llm: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.LLM, code, message, ...opts }),

  ocr: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.OCR, code, message, ...opts }),

  aud: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.AUD, code, message, ...opts }),

  emb: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.EMB, code, message, ...opts }),

  sec: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.SEC, code, message, ...opts }),

  bk: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.BK, code, message, ...opts }),

  sync: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.SYNC, code, message, ...opts }),

  confl: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.CONFL, code, message, ...opts }),

  prop: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.PROP, code, message, ...opts }),

  push: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.PUSH, code, message, ...opts }),

  quiz: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.QUIZ, code, message, ...opts }),

  str: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.STR, code, message, ...opts }),

  rel: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.REL, code, message, ...opts }),

  ws: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.WS, code, message, ...opts }),

  rate: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.RATE, code, message, ...opts }),

  cfg: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.CFG, code, message, ...opts }),

  up: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.UP, code, message, ...opts }),

  eval: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.EVAL, code, message, ...opts }),

  life: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.LIFECYCLE, code, message, ...opts }),

  internal: (code: string, message: string, opts: ErrorOptions = {}) =>
    new AppError({ category: ErrorCategory.INTERNAL, code, message, ...opts }),
};
