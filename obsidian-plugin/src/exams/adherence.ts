// v0.15: Adherence — mide cuánto del plan realmente se siguió.

import type { Exam, Flashcard } from "./types.js";
import type { AdherenceRecord, ExamDetailedProgress } from "./boost.js";
import type { ReviewEvent } from "./persistence.js";
// v0.28: ReviewEvent unificado desde persistence (rating numérico 1-4).
export type { ReviewEvent } from "./persistence.js";

// v0.28: re-export para que otros módulos (ui/examDashboard.ts) puedan
// importar AdherenceRecord desde aquí sin importar de boost directamente.
export type { AdherenceRecord, ExamDetailedProgress } from "./boost.js";

/** Repaso registrado: se hizo una card en una fecha. */
// v0.28: ReviewEvent se re-exporta desde persistence.ts (única definición).

export interface AdherenceStore {
  load(): ReviewEvent[];
  save(events: ReviewEvent[]): void;
  append(event: ReviewEvent): void;
}

export class InMemoryAdherenceStore implements AdherenceStore {
  private events: ReviewEvent[] = [];
  load() { return this.events; }
  save(events: ReviewEvent[]) { this.events = events; }
  append(event: ReviewEvent) { this.events.push(event); }
}

/** Calcula la adherencia diaria de un examen comparando plan vs reviews. */
export function computeAdherence(
  exam: Exam,
  reviews: ReviewEvent[],
  windowDays = 7
): AdherenceRecord[] {
  if (!exam.schedule) return [];
  const records: AdherenceRecord[] = [];
  for (const day of exam.schedule.days) {
    const dayReviews = reviews.filter(
      (r) => r.date === day.date && (r.examId === exam.id || r.examId === null)
    );
    const cardIdsSet = new Set(day.cardIds);
    const completed = dayReviews.filter((r) => cardIdsSet.has(r.cardId)).length;
    const planned = day.cards;
    const adherenceRate = planned === 0 ? 1 : Math.min(1, completed / planned);
    records.push({
      examId: exam.id,
      date: day.date,
      planned,
      completed,
      adherenceRate,
      rolling7: 0, // se calcula después
    });
  }
  // Rolling 7
  for (let i = 0; i < records.length; i++) {
    const start = Math.max(0, i - windowDays + 1);
    const slice = records.slice(start, i + 1);
    const sum = slice.reduce((s, r) => s + r.adherenceRate, 0);
    records[i].rolling7 = sum / slice.length;
  }
  return records;
}

/** Adherencia global de un examen (0..1). */
export function overallAdherence(records: AdherenceRecord[]): number {
  if (records.length === 0) return 1;
  const sum = records.reduce((s, r) => s + r.adherenceRate, 0);
  return sum / records.length;
}

/** Adherencia de los últimos N días. */
export function recentAdherence(records: AdherenceRecord[], days = 3): number {
  const recent = records.slice(-days);
  if (recent.length === 0) return 1;
  return recent.reduce((s, r) => s + r.adherenceRate, 0) / recent.length;
}

/** Identifica días problemáticos. */
export function problemDays(records: AdherenceRecord[], threshold = 0.5): AdherenceRecord[] {
  return records.filter((r) => r.adherenceRate < threshold);
}

/** Progreso detallado con adherencia. */
export function detailedProgress(
  exam: Exam,
  cards: Flashcard[],
  reviews: ReviewEvent[]
): ExamDetailedProgress {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const examDate = new Date(exam.date);
  examDate.setHours(0, 0, 0, 0);
  const daysUntil = Math.max(0, Math.round((examDate.getTime() - today.getTime()) / 86_400_000));
  const total = cards.length;
  // v0.28: leer de root (legacy) o fsrs (nuevo). Backward-compatible.
  const getReps = (c: Flashcard): number => (c as any).reps ?? c.fsrs?.reps ?? 0;
  const getStab = (c: Flashcard): number => (c as any).stability ?? c.fsrs?.stability ?? 0;
  const getDiff = (c: Flashcard): number => (c as any).difficulty ?? c.fsrs?.difficulty ?? 0;
  const reviewed = cards.filter((c) => getReps(c) > 0).length;
  const mature = cards.filter((c) => getStab(c) >= 21).length;
  const avgStab = total === 0 ? 0 : cards.reduce((s, c) => s + getStab(c), 0) / total;
  const avgDiff = total === 0 ? 0 : cards.reduce((s, c) => s + getDiff(c), 0) / total;
  const coverage = total === 0 ? 0 : mature / total;
  const created = new Date(exam.createdAt);
  const daysSoFar = Math.max(1, Math.round((today.getTime() - created.getTime()) / 86_400_000));
  const dailyRate = reviewed / daysSoFar;
  const projected = Math.min(1, coverage + (dailyRate * daysUntil) / Math.max(1, total));
  const records = computeAdherence(exam, reviews);
  const adherence = overallAdherence(records);
  return {
    examId: exam.id,
    totalCards: total,
    reviewedCards: reviewed,
    matureCards: mature,
    averageStability: avgStab,
    averageDifficulty: avgDiff,
    coverage,
    daysUntilExam: daysUntil,
    projectedCoverage: projected,
    onTrack: projected >= 0.7 && adherence >= 0.5,
    adherence,
    boosts: [],
    recommendations: [],
  };
}
