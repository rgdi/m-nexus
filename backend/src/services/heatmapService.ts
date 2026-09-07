// heatmapService.ts: agregador de stats para heatmap + dashboard (Fase 3.D).
//
// v0.46: calcula racha actual, racha máxima, total reviews, total cards
// creados, etc, agrupados por día para visualización tipo GitHub.

export interface DailyStat {
  /** Fecha en formato YYYY-MM-DD */
  date: string;
  /** Número de reviews ese día */
  reviews: number;
  /** Número de cards nuevos creadas */
  newCards: number;
  /** Tiempo total de estudio (segundos) */
  studyTimeSec: number;
}

export interface StudyStats {
  /** Stats agrupadas por día (ordenadas cronológicamente) */
  daily: DailyStat[];
  /** Total de reviews */
  totalReviews: number;
  /** Total de cards nuevas (lifetime) */
  totalNewCards: number;
  /** Días estudiados (al menos 1 review) */
  totalDays: number;
  /** Racha actual (días consecutivos hasta hoy) */
  currentStreak: number;
  /** Racha máxima (la racha más larga en la historia) */
  longestStreak: number;
  /** Promedio de reviews/día (sobre días estudiados) */
  avgReviewsPerDay: number;
  /** Mejor día (más reviews) */
  bestDay: DailyStat | null;
  /** Promedio de tiempo de estudio por día (segundos) */
  avgStudyTimePerDay: number;
}

export interface ReviewEvent {
  timestamp: number; // unix ms
  newCard?: boolean;
  studyTimeSec?: number;
}

export class HeatmapService {
  /**
   * Calcula todas las stats a partir de una lista de eventos.
   */
  static compute(events: ReviewEvent[]): StudyStats {
    if (events.length === 0) {
      return {
        daily: [],
        totalReviews: 0,
        totalNewCards: 0,
        totalDays: 0,
        currentStreak: 0,
        longestStreak: 0,
        avgReviewsPerDay: 0,
        bestDay: null,
        avgStudyTimePerDay: 0,
      };
    }

    // Agrupar por día
    const byDay = new Map<string, DailyStat>();
    for (const event of events) {
      const date = new Date(event.timestamp).toISOString().slice(0, 10);
      if (!byDay.has(date)) {
        byDay.set(date, {
          date,
          reviews: 0,
          newCards: 0,
          studyTimeSec: 0,
        });
      }
      const stat = byDay.get(date)!;
      stat.reviews++;
      if (event.newCard) stat.newCards++;
      stat.studyTimeSec += event.studyTimeSec ?? 0;
    }

    // Ordenar cronológicamente
    const daily = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Calcular streaks
    const dateSet = new Set(daily.map((d) => d.date));
    const today = new Date().toISOString().slice(0, 10);

    // Current streak: desde hoy hacia atrás, contar días consecutivos con reviews
    let currentStreak = 0;
    const cursor = new Date();
    while (dateSet.has(cursor.toISOString().slice(0, 10))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Longest streak: longest run de días consecutivos
    let longestStreak = 0;
    let runStreak = 0;
    let prevDate: Date | null = null;
    for (const d of daily) {
      const dDate = new Date(d.date);
      if (prevDate === null) {
        runStreak = 1;
      } else {
        const diffDays = Math.floor((dDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          runStreak++;
        } else {
          runStreak = 1;
        }
      }
      if (runStreak > longestStreak) longestStreak = runStreak;
      prevDate = dDate;
    }

    const totalReviews = daily.reduce((s, d) => s + d.reviews, 0);
    const totalNewCards = daily.reduce((s, d) => s + d.newCards, 0);
    const totalDays = daily.length;
    const avgReviewsPerDay = totalDays > 0 ? totalReviews / totalDays : 0;
    const avgStudyTimePerDay = totalDays > 0
      ? daily.reduce((s, d) => s + d.studyTimeSec, 0) / totalDays
      : 0;

    // Best day: día con más reviews
    const bestDay = daily.length > 0
      ? daily.reduce((best, d) => (d.reviews > (best?.reviews ?? 0) ? d : best), null as DailyStat | null)
      : null;

    return {
      daily,
      totalReviews,
      totalNewCards,
      totalDays,
      currentStreak,
      longestStreak,
      avgReviewsPerDay,
      bestDay,
      avgStudyTimePerDay,
    };
  }

  /**
   * Genera el color intensity bucket (0-4) estilo GitHub para un día.
   * Útil para construir el heatmap.
   */
  static intensityBucket(reviews: number): 0 | 1 | 2 | 3 | 4 {
    if (reviews === 0) return 0;
    if (reviews <= 5) return 1;
    if (reviews <= 15) return 2;
    if (reviews <= 30) return 3;
    return 4;
  }

  /**
   * Genera todas las fechas en un rango (para heatmap calendario).
   * Si no hay reviews en una fecha, devuelve reviews=0.
   */
  static fillRange(daily: DailyStat[], start: string, end: string): DailyStat[] {
    const map = new Map(daily.map((d) => [d.date, d]));
    const result: DailyStat[] = [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const d = cursor.toISOString().slice(0, 10);
      result.push(
        map.get(d) ?? {
          date: d,
          reviews: 0,
          newCards: 0,
          studyTimeSec: 0,
        }
      );
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }
}
