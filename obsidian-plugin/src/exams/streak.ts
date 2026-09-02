// v0.17/18: Tipos base del sistema de streaks.
// Antes estos tipos estaban en `persistentStreak.ts` y se referenciaban
// como `./streak.js` (módulo fantasma). Ahora están aquí.

/** Estado del streak (versión base, sin v2 features). */
export interface StreakData {
  /** Días consecutivos de estudio. */
  current: number;
  /** Mejor racha histórica. */
  best: number;
  /** Fecha del último estudio (YYYY-MM-DD en local). */
  lastStudyDate: string | null;
  /** Historial de sesiones de estudio. */
  history: StudySession[];
  /** Milestones alcanzados (e.g., [7, 30]). */
  milestonesReached: number[];
}

/** Sesión individual de estudio. */
export interface StudySession {
  date: string;
  cardsReviewed: number;
  durationMs: number;
  examId?: string;
}

/** Resultado de actualizar el streak. */
export interface StreakUpdate {
  /** Streak anterior. */
  previousStreak: number;
  /** Nuevo streak. */
  newStreak: number;
  /** Milestone alcanzado (e.g., 7, 30) o null. */
  milestoneReached: number | null;
  /** Si es nuevo récord. */
  isNewRecord: boolean;
  /** Si el streak se rompió. */
  streakBroken: boolean;
}
