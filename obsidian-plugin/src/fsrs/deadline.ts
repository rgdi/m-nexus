// Deadline scheduling: si la tarjeta está asociada a un examen próximo,
// acortamos intervalos para asegurar over-learning antes de la fecha.
// Estrategia: cuanto más cerca el examen, más alta la "presión" y por tanto
// menor el intervalo objetivo de retención.

import { FlashcardDraft, MNexusFrontmatter } from "../types";
import { FsrsCard, nextInterval, review as fsrsReview } from "./scheduler";

export interface DeadlineContext {
  /** Fecha del examen. */
  examDate: Date;
  /** Hoy. */
  today: Date;
  /** Retención base configurada. */
  baseRetention: number;
}

/** Ajusta la retención objetivo según la cercanía del examen. */
export function adjustedRetention(ctx: DeadlineContext): number {
  const days = Math.max(0, (ctx.examDate.getTime() - ctx.today.getTime()) / (24 * 3600 * 1000));
  // A más días, retención base. A menos días, sube la retención (más repasos).
  if (days > 30) return ctx.baseRetention;
  if (days > 14) return clamp(ctx.baseRetention + 0.05, 0.5, 0.98);
  if (days > 7) return clamp(ctx.baseRetention + 0.08, 0.5, 0.98);
  return clamp(ctx.baseRetention + 0.1, 0.5, 0.98);
}

/** Recalcula la tarjeta forzando una retención efectiva. */
export function applyDeadline(
  card: FsrsCard,
  ctx: DeadlineContext
): { newIntervalDays: number; effectiveRetention: number } {
  const r = adjustedRetention(ctx);
  return { newIntervalDays: nextInterval(card.stability, r), effectiveRetention: r };
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}
