// v0.18: AdherenceMonitorV2 con focus mode que skipea el tick completo
// (ahorra CPU cuando el usuario está en focus).

import type { Exam } from "./types.js";
import { NotificationServiceV2, detectAllV2, type NotificationEvent } from "./notificationsV2.js";
import { recentAdherence } from "./adherence.js";
import { summarizeAdherence } from "./autoRebalance.js";
import type { PersistentAdherenceStore } from "./persistentAdherence.js";
import type { PersistentStreakTracker } from "./persistentStreak.js";

export interface MonitorOptions {
  intervalHours: number;
  enabled: boolean;
}

export const DEFAULT_MONITOR_OPTIONS: MonitorOptions = {
  intervalHours: 4,
  enabled: true,
};

export interface MonitorContext {
  examManager: { list: (filter?: { status?: Exam["status"] }) => Exam[] };
  notificationService: NotificationServiceV2;
  streakTracker: PersistentStreakTracker;
  adherenceStore: PersistentAdherenceStore;
  onNotify?: (events: NotificationEvent[]) => void;
  onCheck?: (events: NotificationEvent[]) => void;
  useRealTimer?: boolean;
  now?: () => number;
  /** Checker de focus mode. */
  isInFocusMode?: () => boolean;
  /** v0.19: checker de deep focus mode. */
  isInDeepFocusMode?: () => boolean;
  /** v0.19: si true, deep focus detiene el monitor completamente. */
  deepFocusStopsMonitor?: boolean;
}

export class AdherenceMonitorV2 {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private options: MonitorOptions;
  private context: MonitorContext;
  private lastCheckAt: number = 0;
  private totalChecks = 0;
  private totalSkippedByFocus = 0;
  private totalSkippedByDeepFocus = 0;
  private running = false;
  private nowFn: () => number;
  /** Logger. */
  public log: (msg: string, data?: unknown) => void = () => {};

  constructor(options: Partial<MonitorOptions>, context: MonitorContext) {
    this.options = { ...DEFAULT_MONITOR_OPTIONS, ...options };
    this.context = context;
    this.nowFn = context.now ?? Date.now;
    this.context.notificationService.setFocusChecker(
      context.isInFocusMode ?? (() => false)
    );
  }

  start(): void {
    if (this.running) return;
    if (!this.options.enabled) return;
    this.running = true;
    const intervalMs = this.options.intervalHours * 3600 * 1000;
    if (this.context.useRealTimer !== false) {
      this.intervalId = setInterval(() => this.tick(), intervalMs);
    }
    this.tick();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
  }

  /** v0.19: tick con deep focus check PRIMERO (más restrictivo que focus normal). */
  tick(): NotificationEvent[] {
    this.totalChecks++;
    this.lastCheckAt = this.nowFn();

    // v0.19: deep focus mode = silencia TODO (incluye monitor).
    if (this.context.isInDeepFocusMode?.() && this.context.deepFocusStopsMonitor !== false) {
      this.totalSkippedByDeepFocus++;
      this.log("[monitor] tick skipped: deep focus mode active");
      this.context.onCheck?.([]);
      return [];
    }

    // v0.18: focus mode normal = silencia notificaciones pero el monitor corre.
    if (this.context.isInFocusMode?.()) {
      this.totalSkippedByFocus++;
      this.log("[monitor] tick skipped: focus mode active");
      this.context.onCheck?.([]);
      return [];
    }

    // Ya pasó los checks. Proceder con la detección normal.
    const exams = this.context.examManager.list({ status: "active" });

    const examsWithAdherence = exams.map((exam) => {
      const records = this.context.adherenceStore?.loadForExam(exam, 14) ?? [];
      return { exam, records };
    });

    const adhDrops = this.context.notificationService.detectAdherenceDrops(
      examsWithAdherence.map((e) => e.exam)
    );

    const streakData = this.context.streakTracker.getRawData();
    const streak = {
      current: streakData.current,
      milestonesReached: streakData.milestonesReached,
      isActive: this.context.streakTracker.isActive(),
      isAtRisk: this.context.streakTracker.isAtRisk(),
    };

    const otherEvents = detectAllV2(
      this.context.notificationService,
      exams,
      streak
    );

    const events = [...adhDrops, ...otherEvents];
    this.context.onCheck?.(events);
    if (events.length > 0) {
      this.context.onNotify?.(events);
    }
    return events;
  }

  isRunning(): boolean {
    return this.running;
  }

  getLastCheckAt(): number {
    return this.lastCheckAt;
  }

  getTotalChecks(): number {
    return this.totalChecks;
  }

  /** v0.18: contador de ticks saltados por focus mode. */
  getTotalSkippedByFocus(): number {
    return this.totalSkippedByFocus;
  }

  /** v0.19: contador de ticks saltados por deep focus. */
  getTotalSkippedByDeepFocus(): number {
    return this.totalSkippedByDeepFocus;
  }

  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
    if (enabled && !this.running) {
      this.start();
    } else if (!enabled && this.running) {
      this.stop();
    }
  }

  /** Para tests. */
  _setNow(fn: () => number): void {
    this.nowFn = fn;
  }
}
