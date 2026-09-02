// v0.28: Sistema de Snooze — "no me molestes con esto por un tiempo".
//
// Caso de uso real:
//   1. "Esta grabación de clase no la quiero repasar hasta el día del examen"
//   2. "Esta flashcard de anatomía no me la muestres en 3 días, después sí"
//   3. "Esta nota de farmacología me la sáltate siempre (es solo referencia)"
//   4. "Este PDF quítalo de las recomendaciones hasta nuevo aviso"
//
// El snooze se aplica como filtro al scheduling (FSRS, free review, knowledge graph).
// NO se borra la información, solo se marca como "pausada" hasta la fecha indicada.

import { Logger } from "../utils/logger";
import { getBreadcrumbs } from "../utils/breadcrumbs";

const log = new Logger("snooze");

/** Tipos de elementos que se pueden snoozear. */
export type SnoozeableType = "flashcard" | "recording" | "note" | "pdf" | "image" | "template" | "topic" | "tag";

/** Una entrada de snooze individual. */
export interface SnoozeEntry {
  id: string;
  /** Tipo de elemento. */
  type: SnoozeableType;
  /** ID del elemento (o nombre si es topic/tag). */
  targetId: string;
  /** Nombre legible para mostrar en UI. */
  targetName: string;
  /** Cuándo se creó. */
  createdAt: number;
  /** Cuándo expira. Si es null, es indefinido (hasta que se desactive manualmente). */
  expiresAt: number | null;
  /** Razón opcional que dio el usuario. */
  reason?: string;
  /** Quién lo snoozeó (e.g., "user", "system:exam-overload"). */
  source: string;
}

/** Configuración del sistema de snooze. */
export interface SnoozeConfig {
  /** Si el snooze global está activo. */
  enabled: boolean;
  /** Si se puede snoozear indefinidamente (null expiresAt). Default: true. */
  allowIndefinite: boolean;
  /** Duración por defecto cuando se snoozea sin tiempo (ms). Default: 7 días. */
  defaultDurationMs: number;
  /** Máximo de snoozes simultáneos. Default: 100. */
  maxEntries: number;
}

export const DEFAULT_SNOOZE_CONFIG: SnoozeConfig = {
  enabled: true,
  allowIndefinite: true,
  defaultDurationMs: 7 * 24 * 3600_000,
  maxEntries: 100,
};

/** Persistencia del sistema de snooze. */
export interface SnoozePersistence {
  load(): SnoozeEntry[];
  save(entries: SnoozeEntry[]): void;
}

export class SnoozeManager {
  private entries: SnoozeEntry[] = [];
  private config: SnoozeConfig;

  constructor(
    private persistence: SnoozePersistence,
    config: Partial<SnoozeConfig> = {},
  ) {
    this.config = { ...DEFAULT_SNOOZE_CONFIG, ...config };
    this.entries = this.persistence.load() ?? [];
    this.pruneExpired();
  }

  // ── API principal ──

  /** Snooze un elemento por una duración concreta (ms). Si duration=null y allowIndefinite=true, es indefinido. */
  snooze(
    type: SnoozeableType,
    targetId: string,
    targetName: string,
    options: {
      durationMs?: number | null;
      reason?: string;
      source?: string;
    } = {},
  ): SnoozeEntry {
    if (!this.config.enabled) {
      throw new Error("Snooze deshabilitado en settings");
    }
    if (options.durationMs === null && !this.config.allowIndefinite) {
      throw new Error("Snooze indefinido no permitido");
    }
    // Distinguir: undefined → default, null → indefinido, número → usar tal cual
    const durationMs = options.durationMs === undefined
      ? this.config.defaultDurationMs
      : options.durationMs;
    const expiresAt = durationMs === null ? null : Date.now() + durationMs;

    // Eliminar snooze previo del mismo target
    this.entries = this.entries.filter((e) => !(e.type === type && e.targetId === targetId));

    const entry: SnoozeEntry = {
      id: `snooze_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      targetId,
      targetName,
      createdAt: Date.now(),
      expiresAt,
      reason: options.reason,
      source: options.source ?? "user",
    };

    this.entries.push(entry);
    this.enforceMax();
    this.persist();

    log.info(`Snooze creado: ${type}/${targetId} hasta ${expiresAt ? new Date(expiresAt).toISOString() : "indefinido"}`, {
      operation: "snooze.create",
      data: { type, targetId, expiresAt, reason: options.reason, source: entry.source },
    });
    getBreadcrumbs().record("action", "snooze", `Snoozed ${type}:${targetId}`, {
      data: { type, targetId, expiresAt, reason: options.reason },
    });
    return entry;
  }

  /** Snooze rápido por duración humana: "1d", "3d", "1w", "1m", "forever" */
  snoozeFor(
    type: SnoozeableType,
    targetId: string,
    targetName: string,
    duration: string | number | null,
    options: { reason?: string; source?: string } = {},
  ): SnoozeEntry {
    let durationMs: number | null;
    if (duration === null || duration === "forever" || duration === "indefinite" || duration === "always") {
      durationMs = null;
    } else if (typeof duration === "number") {
      durationMs = duration;
    } else {
      durationMs = parseHumanDuration(duration);
      if (durationMs === null) throw new Error(`Duración no parseable: ${duration}`);
    }
    return this.snooze(type, targetId, targetName, { ...options, durationMs });
  }

  /** Snooze hasta una fecha concreta. */
  snoozeUntil(
    type: SnoozeableType,
    targetId: string,
    targetName: string,
    until: Date,
    options: { reason?: string; source?: string } = {},
  ): SnoozeEntry {
    const durationMs = until.getTime() - Date.now();
    if (durationMs < 0) throw new Error("Fecha pasada");
    return this.snooze(type, targetId, targetName, { ...options, durationMs });
  }

  /** Quita el snooze de un elemento. */
  unsnooze(type: SnoozeableType, targetId: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => !(e.type === type && e.targetId === targetId));
    const removed = this.entries.length < before;
    if (removed) {
      this.persist();
      log.info(`Snooze quitado: ${type}/${targetId}`, { operation: "snooze.remove" });
    }
    return removed;
  }

  /** ¿Está snoozeado este elemento AHORA? */
  isSnoozed(type: SnoozeableType, targetId: string): boolean {
    const entry = this.entries.find((e) => e.type === type && e.targetId === targetId);
    if (!entry) return false;
    if (entry.expiresAt === null) return true; // indefinido
    if (Date.now() >= entry.expiresAt) {
      // Expirado: quitar
      this.entries = this.entries.filter((e) => e.id !== entry.id);
      this.persist();
      return false;
    }
    return true;
  }

  /** Devuelve el snooze activo (no expirado) de un target, o null. */
  getActive(type: SnoozeableType, targetId: string): SnoozeEntry | null {
    const entry = this.entries.find((e) => e.type === type && e.targetId === targetId);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.entries = this.entries.filter((e) => e.id !== entry.id);
      this.persist();
      return null;
    }
    return entry;
  }

  /** Filtra una lista de items (cualquier tipo) quitando los snoozeados. */
  filterActive<T extends { id: string; type: SnoozeableType }>(items: T[]): T[] {
    return items.filter((item) => !this.isSnoozed(item.type, item.id));
  }

  /** Lista todos los snoozes activos. */
  list(): SnoozeEntry[] {
    this.pruneExpired();
    return [...this.entries];
  }

  /** Lista snoozes por tipo. */
  listByType(type: SnoozeableType): SnoozeEntry[] {
    return this.list().filter((e) => e.type === type);
  }

  /** Lista snoozes que expiran pronto (en los próximos N ms). */
  listExpiringSoon(withinMs: number = 24 * 3600_000): SnoozeEntry[] {
    const now = Date.now();
    return this.list().filter((e) => e.expiresAt !== null && e.expiresAt - now <= withinMs);
  }

  /** Lista snoozes indefinidos. */
  listIndefinite(): SnoozeEntry[] {
    return this.list().filter((e) => e.expiresAt === null);
  }

  /** Estadísticas. */
  stats(): { total: number; indefinite: number; expiringSoon: number; byType: Record<string, number> } {
    this.pruneExpired();
    const byType: Record<string, number> = {};
    let indefinite = 0;
    for (const e of this.entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.expiresAt === null) indefinite++;
    }
    const expiringSoon = this.listExpiringSoon().length;
    return { total: this.entries.length, indefinite, expiringSoon, byType };
  }

  /** Limpia todos los snoozes. */
  clear(): void {
    this.entries = [];
    this.persist();
    log.info("Snooze limpiado completamente", { operation: "snooze.clear" });
  }

  /** Elimina solo los expirados. */
  private pruneExpired(): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.expiresAt === null || Date.now() < e.expiresAt);
    if (this.entries.length < before) this.persist();
  }

  /** Aplica el límite máximo. */
  private enforceMax(): void {
    if (this.entries.length > this.config.maxEntries) {
      // Eliminar los más antiguos (FIFO)
      this.entries.sort((a, b) => a.createdAt - b.createdAt);
      this.entries = this.entries.slice(this.entries.length - this.config.maxEntries);
    }
  }

  private persist(): void {
    this.persistence.save(this.entries);
  }
}

// ── Helpers ──

/** Parsea duraciones humanas: "1d", "3d", "1w", "2w", "1m", "1h", "30m", "1y". */
export function parseHumanDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  const match = s.match(/^(\d+(?:\.\d+)?)\s*([hdwmy])$/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = match[2];
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  switch (unit) {
    case "h": return n * HOUR;
    case "d": return n * DAY;
    case "w": return n * 7 * DAY;
    case "m": return n * 30 * DAY;
    case "y": return n * 365 * DAY;
    default: return null;
  }
}

/** Formatea una duración humana. */
export function formatHumanDuration(ms: number | null): string {
  if (ms === null) return "indefinido";
  if (ms < 0) return "expirado";
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  if (ms < HOUR) return `${Math.round(ms / 60_000)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  if (ms < 7 * DAY) return `${Math.round(ms / DAY)}d`;
  if (ms < 30 * DAY) return `${Math.round(ms / (7 * DAY))}w`;
  if (ms < 365 * DAY) return `${Math.round(ms / (30 * DAY))}m`;
  return `${Math.round(ms / (365 * DAY))}y`;
}

/** Convierte un timestamp a string legible. */
export function formatExpiry(expiresAt: number | null): string {
  if (expiresAt === null) return "indefinido";
  const remaining = expiresAt - Date.now();
  if (remaining < 0) return "expirado";
  return `en ${formatHumanDuration(remaining)}`;
}
