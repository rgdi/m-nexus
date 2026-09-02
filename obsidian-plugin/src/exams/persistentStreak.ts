// v0.18: PersistentStreakTracker con clock skew detection.
// Refactor: usa timestamps absolutos para evitar breakage por cambio de hora.

import type { StreakData, StudySession, StreakUpdate } from "./streak.js";
import type { PluginDataStorage } from "./persistence.js";
import { getMilestoneMessage, CLOCK_SKEW_THRESHOLD_MS } from "./clockUtils.js";
import { detectClockSkew } from "./clockUtils.js";

const DEFAULT_MILESTONES = [3, 7, 14, 30, 100, 365];

/** Estado extendido para v0.18: timestamps absolutos + skew tracking. */
interface StreakDataV2 extends StreakData {
  /** Timestamp (ms) del último estudio. Para detectar clock skew. */
  lastStudyTimestamp: number | null;
  /** Eventos de clock skew detectados. */
  skewEvents: Array<{ at: number; direction: "forward" | "backward"; amount: number }>;
}

export class PersistentStreakTracker {
  private storage: PluginDataStorage;
  private milestones: number[];
  private threshold: number;

  constructor(
    storage: PluginDataStorage,
    milestones: number[] = DEFAULT_MILESTONES,
    clockSkewThresholdMs: number = CLOCK_SKEW_THRESHOLD_MS
  ) {
    this.storage = storage;
    this.milestones = [...milestones].sort((a, b) => a - b);
    this.threshold = clockSkewThresholdMs;
  }

  /** Lee el streak persistido. IMPORTANTE: devuelve un objeto NUEVO basado en raw
   *  para evitar contaminar el state al leer. Para MUTAR, use storage.getStreak() directamente. */
  private get data(): StreakDataV2 {
    const raw = this.storage.getStreak() as Partial<StreakDataV2>;
    return {
      current: raw.current ?? 0,
      best: raw.best ?? 0,
      lastStudyDate: raw.lastStudyDate ?? null,
      history: Array.isArray(raw.history) ? raw.history : [],
      milestonesReached: Array.isArray(raw.milestonesReached) ? raw.milestonesReached : [],
      lastStudyTimestamp: raw.lastStudyTimestamp ?? null,
      skewEvents: Array.isArray(raw.skewEvents) ? raw.skewEvents : [],
    };
  }

  private set data(d: StreakDataV2) {
    this.storage.setStreak(d);
  }

  /** Registra una sesión de estudio.
   *
   * Acepta `date` (YYYY-MM-DD) o `timestamp` (ms). Si se pasa timestamp,
   * se usa para detectar clock skew. Si se pasa date, se combina con la hora actual.
   */
  recordStudy(session: StudySession & { timestamp?: number }): StreakUpdate {
    // v0.18 FIX: trabajar directamente sobre la referencia del storage.
    const data = this.storage.getStreak() as StreakDataV2;
    // Sanitizar (por si el storage tiene campos faltantes)
    if (!Array.isArray(data.history)) data.history = [];
    if (!Array.isArray(data.milestonesReached)) data.milestonesReached = [];
    if (!Array.isArray(data.skewEvents)) data.skewEvents = [];

    const update: StreakUpdate = {
      previousStreak: data.current ?? 0,
      newStreak: data.current ?? 0,
      milestoneReached: null,
      isNewRecord: false,
      streakBroken: false,
    };

    // Detectar clock skew contra el último timestamp
    const now = session.timestamp ?? Date.now();
    const skew = detectClockSkew(data.lastStudyTimestamp, now, this.threshold);
    if (skew.skewed) {
      data.skewEvents.push({
        at: now,
        direction: skew.direction!,
        amount: skew.amount,
      });
      // Limitar skew events guardados (últimos 20)
      if (data.skewEvents.length > 20) {
        data.skewEvents.splice(0, data.skewEvents.length - 20);
      }
    }

    // Para el cálculo de "mismo día / día consecutivo", usamos el date string
    const today = session.date;

    if (data.lastStudyDate === today) {
      // Mismo día: acumular
      const existingIdx = data.history.findIndex((s) => s.date === today);
      if (existingIdx >= 0) {
        const existing = data.history[existingIdx];
        data.history[existingIdx] = {
          ...existing,
          cardsReviewed: existing.cardsReviewed + session.cardsReviewed,
          durationMs: existing.durationMs + session.durationMs,
          examId: session.examId ?? existing.examId,
        };
      } else {
        data.history.push(session);
      }
      // Actualizar timestamp aunque sea el mismo día
      data.lastStudyTimestamp = now;
      this.storage.setStreak(data);
      return update;
    }

    if (data.lastStudyDate) {
      const last = data.lastStudyDate;
      const [ly, lm, ld] = last.split("-").map((n) => parseInt(n, 10));
      const [ty, tm, td] = today.split("-").map((n) => parseInt(n, 10));
      const lastLocal = new Date(ly, lm - 1, ld);
      const todayLocal = new Date(ty, tm - 1, td);
      const dayDiff = Math.round((todayLocal.getTime() - lastLocal.getTime()) / 86_400_000);

      // v0.18: si hay clock skew, ajustar el cálculo
      if (skew.skewed && skew.direction === "forward") {
        if (dayDiff <= 1) {
          data.current = (data.current ?? 0) + 1;
        } else {
          update.streakBroken = true;
          data.current = 1;
        }
      } else if (skew.skewed && skew.direction === "backward") {
        if (dayDiff < 0) {
          // session.date anterior al lastStudyDate. Mantener racha.
          update.streakBroken = false;
        } else if (dayDiff === 1) {
          data.current = (data.current ?? 0) + 1;
        } else if (dayDiff > 1) {
          update.streakBroken = true;
          data.current = 1;
        } else {
          data.current = 1;
        }
      } else {
        // Sin clock skew
        if (dayDiff === 1) {
          data.current = (data.current ?? 0) + 1;
        } else if (dayDiff > 1) {
          update.streakBroken = true;
          data.current = 1;
        } else {
          // dayDiff < 1: clock skew backward menor (no detectado por threshold)
          data.current = 1;
        }
      }
    } else {
      data.current = 1;
    }

    if ((data.current ?? 0) > (data.best ?? 0)) {
      data.best = data.current;
      update.isNewRecord = true;
    }

    data.lastStudyDate = today;
    data.lastStudyTimestamp = now;
    data.history.push(session);
    update.newStreak = data.current;

    for (const m of this.milestones) {
      if (data.current >= m && !data.milestonesReached.includes(m)) {
        data.milestonesReached.push(m);
        update.milestoneReached = m;
        break;
      }
    }

    this.storage.setStreak(data);
    return update;
  }

  getCurrent(): number {
    this.maybeResetForBreak();
    return this.data.current;
  }

  getBest(): number {
    return this.data.best;
  }

  getLastStudyDate(): string | null {
    return this.data.lastStudyDate;
  }

  getLastStudyTimestamp(): number | null {
    return this.data.lastStudyTimestamp;
  }

  getSkewEvents(): Array<{ at: number; direction: "forward" | "backward"; amount: number }> {
    return [...this.data.skewEvents];
  }

  hasClockSkew(): boolean {
    return this.data.skewEvents.length > 0;
  }

  getLastNDays(n: number): StudySession[] {
    this.maybeResetForBreak();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const result: StudySession[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const session = this.data.history.find((s) => s.date === dateStr);
      result.push(session ?? { date: dateStr, cardsReviewed: 0, durationMs: 0 });
    }
    return result;
  }

  getTotalCards(): number {
    return this.data.history.reduce((s, h) => s + h.cardsReviewed, 0);
  }

  getTotalDurationMs(): number {
    return this.data.history.reduce((s, h) => s + h.durationMs, 0);
  }

  isActive(): boolean {
    if (!this.data.lastStudyDate) return false;
    const now = new Date();
    const [y, m, d] = this.data.lastStudyDate.split("-").map((n) => parseInt(n, 10));
    const last = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return last.getTime() === today.getTime();
  }

  isAtRisk(): boolean {
    this.maybeResetForBreak();
    if (!this.data.lastStudyDate) return false;
    const now = new Date();
    const [y, m, d] = this.data.lastStudyDate.split("-").map((n) => parseInt(n, 10));
    const last = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    return dayDiff === 1;
  }

  daysToNextMilestone(): number | null {
    for (const m of this.milestones) {
      if (this.data.current < m) return m - this.data.current;
    }
    return null;
  }

  nextMilestone(): number | null {
    for (const m of this.milestones) {
      if (this.data.current < m) return m;
    }
    return null;
  }

  reset(): void {
    this.data = {
      current: 0,
      best: 0,
      lastStudyDate: null,
      lastStudyTimestamp: null,
      history: [],
      milestonesReached: [],
      skewEvents: [],
    };
  }

  resetCurrent(): void {
    const best = this.data.best;
    this.data = {
      current: 0,
      best,
      lastStudyDate: null,
      lastStudyTimestamp: null,
      history: [],
      milestonesReached: [],
      skewEvents: [],
    };
  }

  getRawData(): StreakData {
    // Compatibilidad con la interfaz StreakData original
    const v2 = this.data;
    return {
      current: v2.current,
      best: v2.best,
      lastStudyDate: v2.lastStudyDate,
      history: v2.history,
      milestonesReached: v2.milestonesReached,
    };
  }

  /** Si pasaron más de 1 día sin estudiar, current=0. */
  private maybeResetForBreak(): void {
    // v0.18 FIX: trabajar directamente sobre la referencia del storage,
    // no sobre el getter que crea un objeto nuevo cada vez.
    const raw = this.storage.getStreak() as Partial<StreakDataV2>;
    if (!raw.lastStudyDate) return;
    const now = new Date();
    const [y, m, d] = raw.lastStudyDate.split("-").map((n) => parseInt(n, 10));
    const last = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((today.getTime() - last.getTime()) / 86_400_000);
    if (dayDiff > 1 && (raw.current ?? 0) > 0) {
      raw.current = 0;
      this.storage.setStreak(raw as StreakData);
    }
  }
}
