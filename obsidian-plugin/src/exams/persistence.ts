// v0.17: Persistencia real de ReviewEvent y StreakData en data.json del plugin.
//
// En lugar de localStorage (que se pierde al recargar y es por-ventana), usamos
// la API de Obsidian (loadData/saveData) que persiste en data.json del vault.

import type { App, Plugin } from "obsidian";

export interface ReviewEvent {
  cardId: string;
  examId: string | null;
  date: string;
  rating: 1 | 2 | 3 | 4;
  durationMs: number;
  topic?: string;
}

export interface StudySession {
  date: string;
  cardsReviewed: number;
  durationMs: number;
  examId?: string;
}

export interface PersistentState {
  reviews: ReviewEvent[];
  streak: {
    current: number;
    best: number;
    lastStudyDate: string | null;
    history: StudySession[];
    milestonesReached: number[];
  };
  notifications: {
    lastSentByType: Record<string, number>;
  };
  focusUntil: number | null;
  /** v0.19: deep focus mode (silencia TODO). */
  deepFocusUntil: number | null;
  /** v0.19: study goals. */
  goals: {
    goals: Array<{
      id: string;
      type: string;
      target: number;
      current: number;
      periodStart: string;
      periodEnd: string;
      status: string;
      updatedAt: number;
      meta?: Record<string, unknown>;
    }>;
    config: {
      dailyCards: number;
      weeklyCards: number;
      streakDays: number;
      accuracyRate: number;
    };
    completedHistory: Array<{
      id: string;
      type: string;
      target: number;
      current: number;
      periodStart: string;
      periodEnd: string;
      status: string;
      updatedAt: number;
    }>;
  };
  /** v0.20: weekly review snapshots. */
  weeklySnapshots: Array<{
    weekStart: string;
    weekEnd: string;
    totalCards: number;
    totalCorrect: number;
    totalDurationMs: number;
    averageAccuracy: number;
    generatedAt: number;
  }>;
  /** v0.21: horario de clases para schedule matching. */
  classSchedules: Array<{
    subject: string;
    dayOfWeek: number;
    startMinute: number;
    durationMinutes: number;
    location?: string;
    color?: string;
    notes?: string;
  }>;
}

export const DEFAULT_PERSISTENT_STATE: PersistentState = {
  reviews: [],
  streak: {
    current: 0,
    best: 0,
    lastStudyDate: null,
    history: [],
    milestonesReached: [],
  },
  notifications: { lastSentByType: {} },
  focusUntil: null,
  deepFocusUntil: null,
  goals: {
    goals: [],
    config: { dailyCards: 30, weeklyCards: 200, streakDays: 7, accuracyRate: 0.8 },
    completedHistory: [],
  },
  weeklySnapshots: [],
  classSchedules: [],
};

/** Storage backed by Obsidian's plugin data file (data.json). */
export class PluginDataStorage {
  private plugin: Plugin;
  private state: PersistentState;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce de 500ms para evitar escrituras excesivas. */
  private static SAVE_DEBOUNCE_MS = 500;

  constructor(plugin: Plugin, initial?: Partial<PersistentState>) {
    this.plugin = plugin;
    this.state = deepMerge(DEFAULT_PERSISTENT_STATE, initial ?? {});
  }

  /** Carga desde el plugin. Llamar en onload. */
  static async load(plugin: Plugin): Promise<PluginDataStorage> {
    const raw = (await plugin.loadData()) as Partial<PersistentState> | null;
    return new PluginDataStorage(plugin, raw ?? {});
  }

  getState(): PersistentState {
    return this.state;
  }

  // ─── Reviews ──────────────────────────────────────────

  getReviews(): ReviewEvent[] {
    return this.state.reviews;
  }

  /** v0.28: append para ReviewEvent. */
  appendReview(event: ReviewEvent): void {
    this.state.reviews.push(event);
  }

  addReview(event: ReviewEvent): void {
    this.state.reviews.push(event);
    this.scheduleSave();
  }

  addReviewsBatch(events: ReviewEvent[]): void {
    this.state.reviews.push(...events);
    this.scheduleSave();
  }

  reviewsForExam(examId: string): ReviewEvent[] {
    return this.state.reviews.filter((r) => r.examId === examId);
  }

  reviewsSince(timestamp: number): ReviewEvent[] {
    return this.state.reviews.filter((r) => new Date(r.date).getTime() >= timestamp);
  }

  reviewsBetween(startDate: string, endDate: string): ReviewEvent[] {
    return this.state.reviews.filter((r) => r.date >= startDate && r.date <= endDate);
  }

  // ─── Streak ───────────────────────────────────────────

  getStreak() {
    return this.state.streak;
  }

  setStreak(streak: PersistentState["streak"]): void {
    this.state.streak = streak;
    this.scheduleSave();
  }

  // ─── Notifications dedup ─────────────────────────────

  getLastSentByType(): Record<string, number> {
    return this.state.notifications.lastSentByType;
  }

  setLastSentByType(type: string, timestamp: number): void {
    this.state.notifications.lastSentByType[type] = timestamp;
    this.scheduleSave();
  }

  // ─── Focus mode ───────────────────────────────────────

  getFocusUntil(): number | null {
    return this.state.focusUntil;
  }

  isInFocusMode(now: number = Date.now()): boolean {
    if (this.state.focusUntil === null) return false;
    if (now >= this.state.focusUntil) {
      this.state.focusUntil = null;
      this.scheduleSave();
      return false;
    }
    return true;
  }

  enableFocusMode(durationMs: number, now: number = Date.now()): void {
    this.state.focusUntil = now + durationMs;
    this.scheduleSave();
  }

  disableFocusMode(): void {
    this.state.focusUntil = null;
    this.scheduleSave();
  }

  focusRemainingMs(now: number = Date.now()): number {
    if (this.state.focusUntil === null) return 0;
    return Math.max(0, this.state.focusUntil - now);
  }

  // ─── Deep focus (v0.19) ──────────────────────────────

  /** v0.19: deep focus mode = silencia TODO (notificaciones + monitor). */
  getDeepFocusUntil(): number | null {
    return this.state.deepFocusUntil;
  }

  isInDeepFocusMode(now: number = Date.now()): boolean {
    if (this.state.deepFocusUntil === null) return false;
    if (now >= this.state.deepFocusUntil) {
      this.state.deepFocusUntil = null;
      this.scheduleSave();
      return false;
    }
    return true;
  }

  enableDeepFocusMode(durationMs: number, now: number = Date.now()): void {
    this.state.deepFocusUntil = now + durationMs;
    this.scheduleSave();
  }

  disableDeepFocusMode(): void {
    this.state.deepFocusUntil = null;
    this.scheduleSave();
  }

  deepFocusRemainingMs(now: number = Date.now()): number {
    if (this.state.deepFocusUntil === null) return 0;
    return Math.max(0, this.state.deepFocusUntil - now);
  }

  // ─── Goals (v0.19) ───────────────────────────────────

  getGoals(): { goals: Array<{
    id: string;
    type: string;
    target: number;
    current: number;
    periodStart: string;
    periodEnd: string;
    status: string;
    updatedAt: number;
    meta?: Record<string, unknown>;
  }>; config: {
    dailyCards: number;
    weeklyCards: number;
    streakDays: number;
    accuracyRate: number;
  }; completedHistory: Array<{
    id: string;
    type: string;
    target: number;
    current: number;
    periodStart: string;
    periodEnd: string;
    status: string;
    updatedAt: number;
  }> } {
    return this.state.goals;
  }

  setGoals(goals: PersistentState["goals"]): void {
    this.state.goals = goals;
    this.scheduleSave();
  }

  // ─── Class schedules (v0.21) ──────────────────────────

  getClassSchedules(): PersistentState["classSchedules"] {
    return this.state.classSchedules;
  }

  setClassSchedules(schedules: PersistentState["classSchedules"]): void {
    this.state.classSchedules = schedules;
    this.scheduleSave();
  }

  addClassSchedule(sched: PersistentState["classSchedules"][number]): void {
    this.state.classSchedules.push(sched);
    this.scheduleSave();
  }

  // ─── Save ─────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveNow().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[mnexus] failed to save data.json", err);
      });
      this.saveTimer = null;
    }, PluginDataStorage.SAVE_DEBOUNCE_MS);
  }

  async saveNow(): Promise<void> {
    await this.plugin.saveData(this.state);
  }

  // Flush pendiente (llamar antes de unload)
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveNow();
  }
}

/** Helper: detecta App type-safe sin throws. */
export function isAppContext(obj: unknown): obj is App {
  return typeof obj === "object" && obj !== null && "workspace" in (obj as object);
}

/** Deep clone para evitar referencias compartidas. */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepClone((value as Record<string, unknown>)[k]);
  }
  return out as T;
}

/** Deep merge: combina override sobre base, clona referencias de base si no se override. */
function deepMerge<T>(base: T, override: Record<string, unknown>): T {
  const result: Record<string, unknown> = deepClone(base as Record<string, unknown>);
  for (const key of Object.keys(override)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overVal = override[key];
    if (
      baseVal !== null &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal) &&
      overVal !== null &&
      typeof overVal === "object" &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result as T;
}
