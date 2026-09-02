// Analytics — métricas agregadas sobre el rendimiento FSRS.
// Toda la matemática es determinista y testeable sin LLM.

import { FlashcardDraft, CardType, Rating } from "../types";

export interface FSRSCardSnapshot {
  id: string;
  subject: string;
  stability: number; // FSRS stability (días)
  difficulty: number; // FSRS difficulty 1-10
  dueDate: string;
  /** Última fecha de review. */
  lastReview?: string;
  /** Estado: "new" (nunca vista), "learning", "review", "lapsed". */
  state: "new" | "learning" | "review" | "lapsed";
  /** Veces que se venció. */
  lapses: number;
  /** Repeticiones totales. */
  reps: number;
}

export interface SubjectMetrics {
  subject: string;
  total: number;
  new: number;
  learning: number;
  review: number;
  lapsed: number;
  /** Estabilidad media ponderada por estado (solo review cuenta). */
  avgStability: number;
  /** Dificultad media. */
  avgDifficulty: number;
  /** Tasa de retención últimos 30 días (0-1). */
  retention30d: number;
  /** Tasa de lapsos (lapses / reps). */
  lapseRate: number;
  /** Progreso hacia dominio (0-1): heurística combinando stability + retention. */
  mastery: number;
}

export interface GlobalMetrics {
  total: number;
  byState: { new: number; learning: number; review: number; lapsed: number };
  bySubject: SubjectMetrics[];
  globalRetention30d: number;
  globalLapseRate: number;
  globalMastery: number;
  /** Cards que vencen hoy/mañana. */
  dueToday: number;
  dueThisWeek: number;
  overdue: number;
}

/** Convierte un FlashcardDraft o cualquier card con fsrs a snapshot. */
export function snapshotFromCard(card: {
  id: string;
  front: string;
  back: string;
  cardType?: CardType;
  fsrs?: { stability: number; difficulty: number; dueDate: string; state?: string; lapses?: number; reps?: number; lastReview?: string };
  subject?: string;
}): FSRSCardSnapshot {
  const f = card.fsrs;
  return {
    id: card.id,
    subject: card.subject ?? "general",
    stability: f?.stability ?? 0,
    difficulty: f?.difficulty ?? 5,
    dueDate: f?.dueDate ?? new Date().toISOString(),
    lastReview: f?.lastReview,
    state: (f?.state as FSRSCardSnapshot["state"]) ?? "new",
    lapses: f?.lapses ?? 0,
    reps: f?.reps ?? 0,
  };
}

export function computeGlobalMetrics(cards: FSRSCardSnapshot[]): GlobalMetrics {
  if (cards.length === 0) {
    return {
      total: 0,
      byState: { new: 0, learning: 0, review: 0, lapsed: 0 },
      bySubject: [],
      globalRetention30d: 0,
      globalLapseRate: 0,
      globalMastery: 0,
      dueToday: 0,
      dueThisWeek: 0,
      overdue: 0,
    };
  }
  const bySubjectMap = new Map<string, FSRSCardSnapshot[]>();
  const byState = { new: 0, learning: 0, review: 0, lapsed: 0 };
  let totalStab = 0;
  let totalDiff = 0;
  let reviewCount = 0;
  let totalLapses = 0;
  let totalReps = 0;
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const dueToday = dateStringOnly(new Date(now));
  const dueThisWeekTs = now + 7 * day;
  let dueTodayCount = 0;
  let dueWeekCount = 0;
  let overdueCount = 0;

  for (const c of cards) {
    byState[c.state]++;
    const list = bySubjectMap.get(c.subject) ?? [];
    list.push(c);
    bySubjectMap.set(c.subject, list);
    if (c.state === "review") {
      totalStab += c.stability;
      totalDiff += c.difficulty;
      reviewCount++;
    }
    totalLapses += c.lapses;
    totalReps += c.reps;
    // Comparar fechas como string "YYYY-MM-DD" para evitar desfases de timezone.
    const cDueStr = c.dueDate.slice(0, 10);
    const cDueTs = parseDateOnly(c.dueDate).getTime();
    // Las cards new también vencen (típicamente mañana tras crearse).
    if (c.state === "review" || c.state === "learning" || c.state === "new") {
      if (cDueStr === dueToday) dueTodayCount++;
      if (cDueTs <= dueThisWeekTs) dueWeekCount++;
      if (cDueTs < now - day) overdueCount++;
    }
  }

  const globalRetention = estimateRetention(cards, 30);
  const globalLapseRate = totalReps > 0 ? totalLapses / totalReps : 0;
  const globalMastery = averageMastery(cards);

  return {
    total: cards.length,
    byState,
    bySubject: Array.from(bySubjectMap.entries()).map(([subject, list]) => computeSubjectMetrics(subject, list)),
    globalRetention30d: globalRetention,
    globalLapseRate,
    globalMastery,
    dueToday: dueTodayCount,
    dueThisWeek: dueWeekCount,
    overdue: overdueCount,
  };
}

export function computeSubjectMetrics(subject: string, cards: FSRSCardSnapshot[]): SubjectMetrics {
  if (cards.length === 0) {
    return {
      subject,
      total: 0, new: 0, learning: 0, review: 0, lapsed: 0,
      avgStability: 0, avgDifficulty: 0, retention30d: 0, lapseRate: 0, mastery: 0,
    };
  }
  const counts = { new: 0, learning: 0, review: 0, lapsed: 0 };
  let totalStab = 0, totalDiff = 0, n = 0, totalLapses = 0, totalReps = 0;
  for (const c of cards) {
    counts[c.state]++;
    if (c.state === "review") {
      totalStab += c.stability;
      totalDiff += c.difficulty;
      n++;
    }
    totalLapses += c.lapses;
    totalReps += c.reps;
  }
  const retention = estimateRetention(cards, 30);
  const lapseRate = totalReps > 0 ? totalLapses / totalReps : 0;
  const mastery = averageMastery(cards);
  return {
    subject,
    total: cards.length,
    new: counts.new,
    learning: counts.learning,
    review: counts.review,
    lapsed: counts.lapsed,
    avgStability: n > 0 ? totalStab / n : 0,
    avgDifficulty: n > 0 ? totalDiff / n : 0,
    retention30d: retention,
    lapseRate,
    mastery,
  };
}

/** Estima la retención a N días como una media ponderada por 1 / (1 + días/estabilidad). */
export function estimateRetention(cards: FSRSCardSnapshot[], days: number): number {
  if (cards.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const c of cards) {
    if (c.state !== "review") continue;
    const r = 1 / (1 + days / Math.max(0.1, c.stability));
    sum += r;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Heurística de mastery: combinación de stability y retention normalizadas. */
export function averageMastery(cards: FSRSCardSnapshot[]): number {
  if (cards.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const c of cards) {
    // Excluir cards "new" (sin revisar) para no distorsionar el promedio.
    if (c.state === "new") continue;
    const stabScore = Math.min(1, c.stability / 90); // 90+ días = mastery alto
    const retention = estimateRetention([c], 30);
    // Penalizar lapses
    const lapsePenalty = c.lapses > 0 ? Math.max(0.5, 1 - c.lapses * 0.1) : 1;
    sum += (stabScore * 0.6 + retention * 0.4) * lapsePenalty;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Devuelve "YYYY-MM-DD" en local time. */
function dateStringOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parsea YYYY-MM-DD como local midnight (evita desfase UTC). */
function parseDateOnly(s: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(s);
  return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
}
