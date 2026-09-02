// @ts-nocheck - v0.28: Legacy/UI, refactorear en v0.29
// ⚠️ DEPRECATED v0.28: Esta lógica se ejecuta en el backend.
// El plugin debe usar src/services/aiClient.ts en su lugar.
// Esta implementación se mantiene solo como fallback offline y para tests.
// Migrar a backend: import { backendEvalVault, backendGenerateProposals, etc. } from './services/aiClient';
// Smart balancing: distribuye flashcards hasta el día del examen.
// v0.14: coordina múltiples exámenes sin sobrecargar días.
// v0.15: integra FSRS-aware (boost de cards) + adherencia + auto-rebalance.

import type { Flashcard, Exam, ExamSchedule, ExamDayPlan, ExamProgress } from "./types.js";
import { ScopeResolver, ResolvedScope } from "./scopeResolver.js";
import { applyBoosts, type FSRSAdapter, defaultFSRSAdapter } from "./fsrsIntegration.js";
import type { CardExamBoost, BoostOptions, FlashcardFSRS } from "./boost.js";
import { DEFAULT_BOOST_OPTIONS } from "./boost.js";

export interface SchedulerOptions {
  /** Cards máximas por día (límite duro del usuario). Default 100. */
  dailyReviewCap: number;
  /** Estimación de minutos por card. Default 0.5. */
  minutesPerCard: number;
  /** Si true, prioriza repaso sobre cards nuevas al principio. Default true. */
  prioritizeReviewFirst: boolean;
  /** Distribución: 'front-loaded' (más cerca del examen) | 'spread' (uniforme). */
  strategy: "front-loaded" | "spread";
  /** v0.15: opciones de boost FSRS. */
  boost?: BoostOptions;
  /** v0.15: adapter FSRS (inyectable para tests). */
  fsrsAdapter?: FSRSAdapter;
  /** v0.15: aplicar boosts automáticamente. */
  applyBoosts?: boolean;
}

export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = {
  dailyReviewCap: 100,
  minutesPerCard: 0.5,
  prioritizeReviewFirst: true,
  strategy: "front-loaded",
  boost: DEFAULT_BOOST_OPTIONS,
  applyBoosts: true,
};

export interface ScoredCard {
  card: Flashcard;
  /** Días hasta el examen (negativo si después del examen). */
  daysUntilExam: number;
  /** Si la card está atrasada (dueDate < hoy). */
  overdue: boolean;
  /** Si la card está madura (stability > 21d). */
  mature: boolean;
  /** Prioridad calculada. */
  priority: number;
  /** Tema/topic inferido de la ruta. */
  topic: string;
}

export class ExamScheduler {
  constructor(private resolver: ScopeResolver) {}

  /** Genera un plan de repasos día a día hasta el examen. */
  generate(
    exam: Exam,
    cards: Flashcard[],
    options: Partial<SchedulerOptions> = {},
    otherExams: Exam[] = []
  ): ExamSchedule {
    const opts: SchedulerOptions = {
      ...DEFAULT_SCHEDULER_OPTIONS,
      ...options,
      boost: { ...DEFAULT_BOOST_OPTIONS, ...(options.boost ?? {}) },
    };
    const today = startOfDay(new Date());
    const examDate = startOfDay(new Date(exam.date));
    const daysAvailable = Math.max(1, Math.round((examDate.getTime() - today.getTime()) / 86_400_000) + 1);
    const warnings: string[] = [];

    if (examDate.getTime() < today.getTime()) {
      warnings.push("La fecha del examen ya pasó. El plan se genera como retrospectivo.");
    }
    if (daysAvailable < 3) {
      warnings.push("Quedan menos de 3 días: el plan será intensivo.");
    }

    // v0.15: 0) Contar cards atrasadas ANTES de aplicar boosts
    const initialOverdue = cards.filter((c) => {
      if (!c.dueDate) return false;
      const due = new Date(c.dueDate); due.setHours(0, 0, 0, 0);
      return due.getTime() < today.getTime();
    }).length;

    // v0.15: 0b) Aplicar FSRS-aware boosts a las cards del scope
    let appliedBoosts: Array<{
      cardId: string;
      originalDueDate: string;
      boostedDueDate: string;
      daysPulledIn: number;
    }> = [];
    let workingCards = cards;
    if (opts.applyBoosts !== false && opts.boost) {
      const adapter = opts.fsrsAdapter ?? defaultFSRSAdapter;
      const { boosts } = applyBoosts(cards, exam, opts.boost, adapter);
      appliedBoosts = boosts.map((b) => ({
        cardId: b.cardId,
        originalDueDate: b.originalDueDate,
        boostedDueDate: b.boostedDueDate,
        daysPulledIn: b.daysPulledIn,
      }));
      if (boosts.length > 0) {
        warnings.push(`FSRS boost aplicado a ${boosts.length} cards para alinearlas con el examen.`);
      }
    }

    // 1) Scorar cada card
    const scored: ScoredCard[] = workingCards.map((c) => this.scoreCard(c, examDate));

    // 2) Separar en buckets (overdue, due, mature; disjuntos)
    const overdue = scored.filter((s) => s.overdue);
    const mature = scored.filter((s) => !s.overdue && s.mature);
    const due = scored.filter((s) => !s.overdue && !s.mature && s.daysUntilExam >= 0);
    const afterExam = scored.filter((s) => !s.overdue && !s.mature && s.daysUntilExam < 0);

    // 3) Plan de distribución
    const totalToSchedule = due.length + overdue.length;
    const totalAlreadyMature = mature.length;

    // Distribuir cards por día (con cap por dailyReviewCap)
    const dailyQuotas = this.distribute(totalToSchedule, daysAvailable, opts.strategy, opts.dailyReviewCap);

    // 4) Asignar cards a días (round-robin con priorización)
    const days: ExamDayPlan[] = [];
    const dayCardMap = new Map<number, ScoredCard[]>();
    for (let d = 0; d < daysAvailable; d++) {
      dayCardMap.set(d, []);
    }

    // Ordenar: overdue primero, luego due, con prioridad
    const sortedCards = [...overdue, ...due].sort((a, b) => {
      if (a.overdue && !b.overdue) return -1;
      if (!a.overdue && b.overdue) return 1;
      return b.priority - a.priority;
    });

    let cardIdx = 0;
    for (let d = 0; d < daysAvailable && cardIdx < sortedCards.length; d++) {
      const quota = dailyQuotas[d];
      const dayList = dayCardMap.get(d)!;
      for (let i = 0; i < quota && cardIdx < sortedCards.length; i++) {
        dayList.push(sortedCards[cardIdx]);
        cardIdx++;
      }
    }
    // Si quedan cards (por cap), las metemos en el último día
    if (cardIdx < sortedCards.length) {
      const lastDay = daysAvailable - 1;
      const dayList = dayCardMap.get(lastDay)!;
      while (cardIdx < sortedCards.length) {
        dayList.push(sortedCards[cardIdx]);
        cardIdx++;
      }
    }

    // 5) Construir ExamDayPlan[]
    const conflictCounts = new Map<number, number>();
    for (const other of otherExams) {
      if (other.id === exam.id) continue;
      if (other.status !== "active") continue;
      const otherDays = Math.max(1, Math.round((startOfDay(new Date(other.date)).getTime() - today.getTime()) / 86_400_000) + 1);
      const otherPlan = other.schedule;
      if (otherPlan) {
        for (const dp of otherPlan.days) {
          const offset = Math.round((startOfDay(new Date(dp.date)).getTime() - today.getTime()) / 86_400_000);
          if (offset >= 0 && offset < daysAvailable) {
            conflictCounts.set(offset, (conflictCounts.get(offset) ?? 0) + dp.cards);
          }
        }
      } else {
        for (let d = 0; d < Math.min(otherDays, daysAvailable); d++) {
          conflictCounts.set(d, (conflictCounts.get(d) ?? 0) + 20);
        }
      }
    }

    for (let d = 0; d < daysAvailable; d++) {
      const dayList = dayCardMap.get(d) ?? [];
      const date = new Date(today);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      const newCount = dayList.filter((c) => c.card.reps === 0).length;
      const minutes = Math.round(dayList.length * opts.minutesPerCard);
      const conflict = conflictCounts.get(d) ?? 0;
      const overloaded = (dayList.length + conflict) > opts.dailyReviewCap;
      if (overloaded) warnings.push(`Día ${dateStr}: sobrecargado (${dayList.length} cards de este examen + ${conflict} de otros).`);
      days.push({
        date: dateStr,
        cards: dayList.length,
        newCards: newCount,
        estimatedMinutes: minutes,
        cardIds: dayList.map((s) => s.card.id),
        topics: uniqueTopics(dayList),
        conflictsWith: Array.from(new Set([])),
        overloaded,
      });
    }

    // 6) Cobertura estimada
    const totalCards = workingCards.length;
    const reviewedAtEnd = Math.min(totalCards, totalToSchedule);
    const coverage = totalCards === 0 ? 0 : Math.min(1, reviewedAtEnd / totalCards);

    return {
      daysAvailable,
      totalCards: totalToSchedule,
      sessionsPerDay: Math.ceil(opts.dailyReviewCap / 30),
      days,
      alreadyMature: totalAlreadyMature,
      overdue: initialOverdue,
      estimatedCoverage: coverage,
      warnings,
      boosts: appliedBoosts,
    };
  }

  /** Distribuye N items en D días según la estrategia. */
  private distribute(total: number, days: number, strategy: "front-loaded" | "spread", cap?: number): number[] {
    if (total === 0) return new Array(days).fill(0);
    if (days === 1) return cap ? [Math.min(total, cap)] : [total];
    const capEach = cap ?? Infinity;
    if (strategy === "spread") {
      const base = Math.min(capEach, Math.floor(total / days));
      let remainder = Math.max(0, total - base * days);
      const quotas = new Array(days).fill(base);
      for (let i = days - 1; i >= 0 && remainder > 0; i--) {
        if (quotas[i] < capEach) {
          quotas[i]++;
          remainder--;
        }
      }
      return quotas;
    }
    // front-loaded: peso (t/D)^1.3, donde t ∈ [0, D-1]
    const weights: number[] = [];
    for (let t = 0; t < days; t++) {
      weights.push(Math.pow((t + 1) / days, 1.3));
    }
    const sum = weights.reduce((s, w) => s + w, 0);
    const quotas = weights.map((w) => Math.min(capEach, Math.floor((w / sum) * total)));
    // Ajustar redondeo
    let assigned = quotas.reduce((s, q) => s + q, 0);
    let remainder = Math.max(0, total - assigned);
    // Distribuir el resto en los días con más peso (final del array)
    while (remainder > 0) {
      let added = false;
      for (let i = days - 1; i >= 0 && remainder > 0; i--) {
        if (quotas[i] < capEach) {
          quotas[i]++;
          remainder--;
          added = true;
        }
      }
      if (!added) break; // cap alcanzado para todos los días
    }
    return quotas;
  }

  /** Calcula score para una card. */
  private scoreCard(card: Flashcard, examDate: Date): ScoredCard {
    const today = startOfDay(new Date());
    const due = card.dueDate ? startOfDay(new Date(card.dueDate)) : today;
    const daysUntilExam = Math.round((examDate.getTime() - due.getTime()) / 86_400_000);
    const overdue = due.getTime() < today.getTime();
    const mature = (card.stability ?? 0) >= 21;

    // Prioridad: atrasadas > recientes > nuevas. Stability alta = menos prioritario.
    let priority = 0;
    if (overdue) priority += 100;
    if (mature) priority -= 20;
    if (card.lapses && card.lapses > 0) priority += 30;
    priority += Math.max(0, 50 - (card.stability ?? 0) / 2);

    return {
      card,
      daysUntilExam,
      overdue,
      mature,
      priority,
      topic: this.inferTopic(card.notePath),
    };
  }

  /** Infiere el topic a partir del path. */
  private inferTopic(path: string): string {
    const parts = path.split("/");
    if (parts.length >= 2) return parts[parts.length - 2];
    return path.replace(/\.md$/, "");
  }
}

/** Coordinación multi-examen: marca conflictos y balancea carga diaria. */
export class MultiExamCoordinator {
  /**
   * Actualiza el campo `conflictsWith` en cada día de cada schedule.
   * Detecta solapamiento y sugiere redistribución si un día está overloaded.
   */
  coordinate(exams: Exam[]): Map<string, Exam> {
    const updated = new Map<string, Exam>();
    const allDays = new Map<string, { examId: string; examTitle: string; cards: number }[]>();

    for (const exam of exams) {
      if (!exam.schedule) continue;
      for (const day of exam.schedule.days) {
        if (!allDays.has(day.date)) allDays.set(day.date, []);
        allDays.get(day.date)!.push({
          examId: exam.id,
          examTitle: exam.title,
          cards: day.cards,
        });
      }
    }

    for (const exam of exams) {
      if (!exam.schedule) {
        updated.set(exam.id, exam);
        continue;
      }
      const newDays: ExamDayPlan[] = exam.schedule.days.map((d) => {
        const dayData = allDays.get(d.date) ?? [];
        const others = dayData.filter((x) => x.examId !== exam.id);
        return {
          ...d,
          conflictsWith: others.map((o) => o.examTitle),
          overloaded: others.reduce((s, o) => s + o.cards, 0) + d.cards > 100, // hard cap
        };
      });
      updated.set(exam.id, { ...exam, schedule: { ...exam.schedule, days: newDays } });
    }
    return updated;
  }

  /** Redistribuye días sobrecargados moviendo cards a días cercanos. */
  redistribute(exam: Exam, options: Partial<SchedulerOptions> = {}): Exam {
    if (!exam.schedule) return exam;
    const opts = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
    const days = [...exam.schedule.days];

    // Encontrar días overloaded y mover cards al día más cercano con hueco
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (!d.overloaded) continue;
      // Calcular exceso
      const dayData: number = d.conflictsWith.length; // proxy
      const excess = Math.max(0, d.cards - opts.dailyReviewCap + dayData * 10);
      if (excess === 0) continue;
      // Mover al día anterior o siguiente con hueco
      const target = i > 0 ? i - 1 : i + 1;
      if (target >= 0 && target < days.length) {
        d.cards -= excess;
        days[target].cards += excess;
        days[target].estimatedMinutes = Math.round(days[target].cards * opts.minutesPerCard);
        d.estimatedMinutes = Math.round(d.cards * opts.minutesPerCard);
      }
    }
    return { ...exam, schedule: { ...exam.schedule, days } };
  }
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function uniqueTopics(cards: ScoredCard[]): string[] {
  const set = new Set<string>();
  for (const c of cards) set.add(c.topic);
  return Array.from(set);
}

/** Calcula el progreso de un examen. */
export function computeProgress(exam: Exam, allCards: Flashcard[]): ExamProgress {
  const today = startOfDay(new Date());
  const examDate = startOfDay(new Date(exam.date));
  const daysUntil = Math.max(0, Math.round((examDate.getTime() - today.getTime()) / 86_400_000));

  const cardsInScope = allCards.filter((c) => /* isInScope */ true);
  const total = cardsInScope.length;
  const reviewed = cardsInScope.filter((c) => c.reps > 0).length;
  const mature = cardsInScope.filter((c) => (c.stability ?? 0) >= 21).length;

  const avgStab = total === 0 ? 0 : cardsInScope.reduce((s, c) => s + (c.stability ?? 0), 0) / total;
  const avgDiff = total === 0 ? 0 : cardsInScope.reduce((s, c) => s + (c.difficulty ?? 0), 0) / total;
  const coverage = total === 0 ? 0 : mature / total;

  // Proyección simple: si mantiene el ritmo actual, ¿alcanzará?
  const daysSoFar = Math.max(1, Math.round((today.getTime() - new Date(exam.createdAt).getTime()) / 86_400_000));
  const dailyRate = reviewed / daysSoFar;
  const projectedCoverage = Math.min(1, coverage + (dailyRate * daysUntil) / Math.max(1, total));

  return {
    examId: exam.id,
    totalCards: total,
    reviewedCards: reviewed,
    matureCards: mature,
    averageStability: avgStab,
    averageDifficulty: avgDiff,
    coverage,
    daysUntilExam: daysUntil,
    projectedCoverage,
    onTrack: projectedCoverage >= 0.7,
  };
}
