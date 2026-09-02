// v0.20: Weekly Review — resumen automático de la semana.
//
// Genera estadísticas comparativas entre la semana actual y la anterior.
//   - Cards repasadas
//   - Accuracy
//   - Racha (mejor día, peor día)
//   - Tiempo total de estudio
//   - Goals completados

import type { ReviewEvent } from "./persistence.js";
import type { PluginDataStorage } from "./persistence.js";

export interface DailyStats {
  date: string;
  cards: number;
  correct: number;
  durationMs: number;
  accuracy: number;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  totalCards: number;
  totalCorrect: number;
  totalDurationMs: number;
  averageAccuracy: number;
  bestDay: DailyStats | null;
  worstDay: DailyStats | null;
  /** Comparación con la semana anterior. */
  deltaCards: number;
  deltaAccuracy: number;
  /** Rating de la semana: "great" | "ok" | "low". */
  rating: "great" | "ok" | "low";
  /** Lista de días con stats detalladas. */
  days: DailyStats[];
}

export interface WeeklyReviewSnapshot {
  weekStart: string;
  weekEnd: string;
  totalCards: number;
  totalCorrect: number;
  totalDurationMs: number;
  averageAccuracy: number;
  generatedAt: number;
}

function startOfWeek(timestamp: number = Date.now()): number {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // lunes
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

function endOfWeek(timestamp: number = Date.now()): number {
  return startOfWeek(timestamp) + 7 * 86_400_000 - 1;
}

function dateString(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parsea "YYYY-MM-DD" como local midnight. Acepta también ISO completo. */
function parseLocalDate(s: string): Date {
  if (!s) return new Date(NaN);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(s);
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}

const STORAGE_KEY_SNAPSHOTS = "m-nexus-weekly-snapshots-v1";

export class WeeklyReviewService {
  private storage: PluginDataStorage;
  /** Threshold para considerar la semana "great" / "ok" / "low". */
  private greatThreshold: number;
  private lowThreshold: number;

  constructor(
    storage: PluginDataStorage,
    options: { greatThreshold?: number; lowThreshold?: number } = {}
  ) {
    this.storage = storage;
    this.greatThreshold = options.greatThreshold ?? 0.85;
    this.lowThreshold = options.lowThreshold ?? 0.5;
  }

  /** Genera el review de la semana actual. */
  generateCurrentWeek(now: number = Date.now()): WeeklyReview {
    return this.generateWeek(startOfWeek(now), endOfWeek(now), now);
  }

  /** Genera el review de la semana anterior. */
  generateLastWeek(now: number = Date.now()): WeeklyReview {
    const lastWeekStart = startOfWeek(now) - 7 * 86_400_000;
    const lastWeekEnd = startOfWeek(now) - 1;
    return this.generateWeek(lastWeekStart, lastWeekEnd, now);
  }

  /** Genera el review de una semana específica (ms). */
  generateWeek(weekStartMs: number, weekEndMs: number, now: number = Date.now()): WeeklyReview {
    const weekStart = dateString(weekStartMs);
    const weekEnd = dateString(weekEndMs);
    const reviews = this.storage.getReviews();
    const weekReviews = reviews.filter((r) => {
      // Comparar por string de fecha (YYYY-MM-DD) para evitar problemas de timezone.
      // Acepta tanto "YYYY-MM-DD" como ISO completo ("YYYY-MM-DDTHH:mm:ss").
      const rDate = typeof r.date === "string" ? r.date.slice(0, 10) : "";
      return rDate >= weekStart && rDate <= weekEnd;
    });

    // Stats por día
    const dayMap = new Map<string, DailyStats>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStartMs + i * 86_400_000);
      const ds = dateString(d.getTime());
      dayMap.set(ds, { date: ds, cards: 0, correct: 0, durationMs: 0, accuracy: 0 });
    }

    for (const r of weekReviews) {
      const stats = dayMap.get(r.date);
      if (!stats) continue;
      stats.cards++;
      if (r.rating >= 3) stats.correct++;
      stats.durationMs += r.durationMs;
    }

    const days: DailyStats[] = [];
    for (const s of dayMap.values()) {
      s.accuracy = s.cards > 0 ? s.correct / s.cards : 0;
      days.push(s);
    }

    const totalCards = weekReviews.length;
    const totalCorrect = weekReviews.filter((r) => r.rating >= 3).length;
    const totalDurationMs = weekReviews.reduce((s, r) => s + r.durationMs, 0);
    const averageAccuracy = totalCards > 0 ? totalCorrect / totalCards : 0;

    // Best/worst day (solo días con cards)
    const daysWithCards = days.filter((d) => d.cards > 0);
    const bestDay = daysWithCards.length > 0
      ? daysWithCards.reduce((a, b) => (a.cards > b.cards ? a : b))
      : null;
    const worstDay = daysWithCards.length > 0
      ? daysWithCards.reduce((a, b) => (a.accuracy < b.accuracy ? a : b))
      : null;

    // Comparación con la semana anterior
    const prevWeekMs = weekStartMs - 7 * 86_400_000;
    const prevReviews = reviews.filter((r) => {
      // Parsear fecha como local midnight para evitar desfase UTC.
      const rDateStr = typeof r.date === "string" ? r.date.slice(0, 10) : "";
      const d = parseLocalDate(rDateStr);
      return d.getTime() >= prevWeekMs && d.getTime() < weekStartMs;
    });
    const prevTotalCards = prevReviews.length;
    const prevTotalCorrect = prevReviews.filter((r) => r.rating >= 3).length;
    const prevAccuracy = prevTotalCards > 0 ? prevTotalCorrect / prevTotalCards : 0;

    const deltaCards = totalCards - prevTotalCards;
    const deltaAccuracy = averageAccuracy - prevAccuracy;

    let rating: "great" | "ok" | "low" = "ok";
    if (averageAccuracy >= this.greatThreshold && totalCards > 0) rating = "great";
    else if (averageAccuracy < this.lowThreshold) rating = "low";

    return {
      weekStart,
      weekEnd,
      totalCards,
      totalCorrect,
      totalDurationMs,
      averageAccuracy,
      bestDay,
      worstDay,
      deltaCards,
      deltaAccuracy,
      rating,
      days,
    };
  }

  /** Persiste un snapshot de la semana actual. */
  saveSnapshot(review: WeeklyReview): void {
    const snapshots = this.getSnapshots();
    const idx = snapshots.findIndex((s) => s.weekStart === review.weekStart);
    const snap: WeeklyReviewSnapshot = {
      weekStart: review.weekStart,
      weekEnd: review.weekEnd,
      totalCards: review.totalCards,
      totalCorrect: review.totalCorrect,
      totalDurationMs: review.totalDurationMs,
      averageAccuracy: review.averageAccuracy,
      generatedAt: Date.now(),
    };
    if (idx >= 0) snapshots[idx] = snap;
    else snapshots.push(snap);
    while (snapshots.length > 12) snapshots.shift();
    // v0.20: persistir en data.json del plugin
    this.saveRawSnapshots(snapshots);
  }

  /** Devuelve los snapshots guardados. */
  getSnapshots(): WeeklyReviewSnapshot[] {
    return this.loadRawSnapshots();
  }

  /** Persiste en data.json. */
  private saveRawSnapshots(snapshots: WeeklyReviewSnapshot[]): void {
    // El PluginDataStorage no tiene read/write genéricos;
    // usamos un campo custom en el state.
    const state = (this.storage as unknown as { getState?: () => Record<string, unknown> }).getState?.();
    if (state) {
      state.weeklySnapshots = snapshots;
    }
  }

  /** Lee desde data.json. */
  private loadRawSnapshots(): WeeklyReviewSnapshot[] {
    const state = (this.storage as unknown as { getState?: () => Record<string, unknown> }).getState?.();
    if (!state) return [];
    const arr = state.weeklySnapshots;
    if (!Array.isArray(arr)) return [];
    return arr as WeeklyReviewSnapshot[];
  }

  /** Devuelve el snapshot de una semana específica. */
  getSnapshot(weekStart: string): WeeklyReviewSnapshot | null {
    return this.getSnapshots().find((s) => s.weekStart === weekStart) ?? null;
  }

  /** Devuelve el snapshot más reciente. */
  getLatestSnapshot(): WeeklyReviewSnapshot | null {
    const all = this.getSnapshots();
    if (all.length === 0) return null;
    return all[all.length - 1];
  }
}
