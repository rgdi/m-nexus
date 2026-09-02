// Tipos para el sistema de exámenes múltiples.
// v0.14: smart balancing + múltiples exámenes simultáneos.

import type { FlashcardDraft } from "../types.js";

/** Forma de incluir contenido en un examen. */
export type ExamScope =
  | { type: "note"; path: string }
  | { type: "folder"; path: string; includeSubfolders: boolean }
  | { type: "tag"; tag: string }
  | { type: "subject"; subject: string };

export type ExamType = "parcial" | "final" | "mir" | "osce" | "custom";
export type ExamStatus = "draft" | "active" | "completed" | "archived";
export type ExamPriority = "low" | "medium" | "high" | "critical";

/**
 * Flashcard usada por el ExamScheduler. Mismo shape que FlashcardDraft, con
 * campos FSRS aplanados (stability/difficulty/dueDate/reps/lapses) y contexto
 * de nota (notePath, subject, tags). Se mantienen alineados con FlashcardDraft
 * para que el loadBalancer pueda traducir.
 */
export interface Flashcard extends FlashcardDraft {
  notePath: string;
  subject?: string;
  tags: string[];
}

/** Examen: ventana de estudio acotada a un conjunto de notas. */
export interface Exam {
  id: string;
  title: string;
  subject: string;
  /** ISO date "YYYY-MM-DD" del examen. */
  date: string;
  examType: ExamType;
  /** Scopes que componen el temario. */
  scopes: ExamScope[];
  /** Estado del examen. */
  status: ExamStatus;
  /** Prioridad (afecta al smart balancing). */
  priority: ExamPriority;
  /** Notas adicionales del usuario. */
  notes?: string;
  /** Color en el dashboard (hex). */
  color?: string;
  createdAt: string;
  updatedAt: string;
  /** Última vez que se regeneró el schedule. */
  scheduleGeneratedAt?: string;
  /** Plan de repasos calculado. */
  schedule?: ExamSchedule;
}

/** Plan de repasos día a día. */
export interface ExamSchedule {
  /** Días desde hoy hasta el examen (inclusive). */
  daysAvailable: number;
  /** Total de cards a estudiar (en todos los días). */
  totalCards: number;
  /** Sessions por día estimadas. */
  sessionsPerDay: number;
  /** Plan por día. */
  days: ExamDayPlan[];
  /** Cards que ya estaban maduras (no se incluyen en el plan). */
  alreadyMature: number;
  /** Cards atrasadas (alta prioridad). */
  overdue: number;
  /** Cobertura estimada del temario al final del plan. */
  estimatedCoverage: number;
  /** Notas sobre el plan. */
  warnings: string[];
  /** v0.15: boosts aplicados. */
  boosts?: Array<{
    cardId: string;
    originalDueDate: string;
    boostedDueDate: string;
    daysPulledIn: number;
  }>;
}

export interface ExamDayPlan {
  date: string;
  cards: number;
  newCards: number;
  estimatedMinutes: number;
  /** IDs de cards programadas para este día. */
  cardIds: string[];
  /** Temas que toca. */
  topics: string[];
  /** Otros exámenes que tienen repaso este día. */
  conflictsWith: string[];
  /** Si el día está sobrecargado. */
  overloaded?: boolean;
}

/** Snapshot de cobertura de un examen. */
export interface ExamProgress {
  examId: string;
  totalCards: number;
  reviewedCards: number;
  matureCards: number;
  averageStability: number;
  averageDifficulty: number;
  coverage: number; // 0..1
  daysUntilExam: number;
  projectedCoverage: number; // estimación al día del examen
  onTrack: boolean;
}
