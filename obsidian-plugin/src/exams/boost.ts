// v0.15: Integración FSRS↔Exam.
// Define los tipos para "boost" de cadencia y adherencia.

import type { Flashcard } from "./types.js";

/** Cómo se decidió ajustar el dueDate de una card. */
export type BoostReason =
  | "exam-before-due"        // el examen es antes del FSRS dueDate
  | "exam-overdue-card"       // la card ya está atrasada y el examen la necesita
  | "exam-scope-priority"     // boost general para cards del scope
  | "user-explicit";          // usuario forzó el boost

/** Cambio de cadencia sugerido por el examen. */
export interface CardExamBoost {
  cardId: string;
  examId: string;
  examTitle: string;
  /** DueDate original (FSRS sin boost). */
  originalDueDate: string;
  /** DueDate con boost aplicado. */
  boostedDueDate: string;
  /** Nº de días adelantados. */
  daysPulledIn: number;
  reason: BoostReason;
  /** Confianza en el boost (0..1). */
  confidence: number;
  /** Si el boost se aplicó (commit) o solo se sugiere. */
  applied: boolean;
}

/** Snapshot de adherencia: cuántas cards se planearon vs repasaron. */
export interface AdherenceRecord {
  examId: string;
  date: string;
  planned: number;
  completed: number;
  /** 0..1. 1 = se hizo todo el plan. */
  adherenceRate: number;
  /** Promedio móvil de los últimos 7 días. */
  rolling7: number;
}

/** Recomendación de rebalance cuando la adherencia cae. */
export type RebalanceAction =
  | { type: "reduce-scope"; impact: number; suggestion: string }
  | { type: "shift-exam"; impact: number; suggestion: string }
  | { type: "increase-cap"; impact: number; suggestion: string }
  | { type: "add-time"; impact: number; suggestion: string }
  | { type: "split-cards"; impact: number; suggestion: string }
  | { type: "lower-priority"; impact: number; suggestion: string };

export interface RebalanceRecommendation {
  examId: string;
  /** Adherencia que disparó esta recomendación. */
  triggerAdherence: number;
  actions: RebalanceAction[];
  /** Si es urgente (adherencia crítica). */
  urgent: boolean;
}

/** Estado de progreso de un examen con más detalle. */
export interface ExamDetailedProgress {
  examId: string;
  totalCards: number;
  reviewedCards: number;
  matureCards: number;
  averageStability: number;
  averageDifficulty: number;
  coverage: number;
  daysUntilExam: number;
  projectedCoverage: number;
  onTrack: boolean;
  /** Adherencia media del plan. */
  adherence: number;
  /** Boosts aplicados. */
  boosts: CardExamBoost[];
  /** Recomendaciones activas. */
  recommendations: RebalanceRecommendation[];
}

/** Filtros para generar boosts. */
export interface BoostOptions {
  /** Días antes del examen en que la card debería estar "fresca". Default 1. */
  daysBeforeExam: number;
  /** Nº de repasos deseados en el scope antes del examen. Default 2. */
  targetReviews: number;
  /** Solo aplicar boost si la adherencia esperada < este umbral. Default 0.7. */
  minAdherence: number;
  /** Boost máximo permitido (no forzar repaso de cards muy lejanas). Default 14 días. */
  maxPullInDays: number;
}

export const DEFAULT_BOOST_OPTIONS: BoostOptions = {
  daysBeforeExam: 1,
  targetReviews: 2,
  minAdherence: 0.7,
  maxPullInDays: 14,
};

/** Card con campos extra para FSRS. */
export interface FlashcardFSRS extends Flashcard {
  /** Estado de boost activo. */
  examBoost?: CardExamBoost;
  /** Última vez que se calculó un boost. */
  lastBoostCheck?: number;
  /** Historial de boosts (para auditoría). */
  boostHistory?: CardExamBoost[];
}
