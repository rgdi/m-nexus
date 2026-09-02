// v0.17: NotificationService con dedup persistente y respeto de focus mode.

import type { Exam, ExamSchedule } from "./types.js";
import type { AdherenceRecord } from "./boost.js";
import { recentAdherence } from "./adherence.js";
import { summarizeAdherence } from "./autoRebalance.js";
import { getMilestoneMessage } from "./clockUtils.js";
import type { PluginDataStorage } from "./persistence.js";

export type NotificationType =
  | "adherence-drop"
  | "streak-milestone"
  | "exam-approaching"
  | "exam-overloaded"
  | "streak-at-risk"
  | "streak-broken"
  | "plan-requires-rebalance"
  | "fsrs-boost-applied"
  | "goal-completed"
  | "weekly-review-ready";

export type NotificationSeverity = "info" | "warning" | "urgent";

export interface NotificationEvent {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  examId?: string;
  timestamp: number;
  severity: NotificationSeverity;
  shown: boolean;
  meta?: Record<string, unknown>;
}

export interface NotificationThresholds {
  adherenceDropThreshold: number;
  streakMilestones: number[];
  examApproachingDays: number[];
  alertStreakAtRisk: boolean;
  maxPerDay: number;
  /** Dedup en horas. Default 24. */
  dedupHours: number;
}

export const DEFAULT_THRESHOLDS: NotificationThresholds = {
  adherenceDropThreshold: 0.5,
  streakMilestones: [3, 7, 14, 30, 100, 365],
  examApproachingDays: [14, 7, 3, 1],
  alertStreakAtRisk: true,
  maxPerDay: 5,
  dedupHours: 24,
};

const EVENTS_KEY = "mnexus-notifications-history-v1";

/** Storage con read/write (puede ser plugin data + memory). */
export interface NotificationStorage {
  read: (k: string) => string | null;
  write: (k: string, v: string) => void;
  /** Devuelve timestamp del último envío de un tipo+examId. */
  getLastSent?: (key: string) => number | null;
  setLastSent?: (key: string, ts: number) => void;
}

/** Historial in-memory de eventos. */
class InMemoryEventLog {
  private events: NotificationEvent[] = [];
  private storage: NotificationStorage;

  constructor(storage: NotificationStorage) {
    this.storage = storage;
    this.load();
  }

  private load(): void {
    const raw = this.storage.read(EVENTS_KEY);
    if (!raw) return;
    try {
      this.events = JSON.parse(raw);
      this.events = this.events.slice(-500);
    } catch {
      this.events = [];
    }
  }

  save(): void {
    this.storage.write(EVENTS_KEY, JSON.stringify(this.events));
  }

  add(event: NotificationEvent): void {
    this.events.push(event);
    this.save();
  }

  recent(limit = 50): NotificationEvent[] {
    return this.events.slice(-limit).reverse();
  }

  unshown(): NotificationEvent[] {
    return this.events.filter((e) => !e.shown);
  }

  markShown(ids: string[]): void {
    let changed = false;
    for (const e of this.events) {
      if (ids.includes(e.id)) {
        e.shown = true;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  prune(cutoff: number): void {
    this.events = this.events.filter((e) => e.timestamp > cutoff);
    this.save();
  }

  all(): NotificationEvent[] {
    return [...this.events];
  }

  todayCount(now: number): number {
    const today = new Date(now).toISOString().slice(0, 10);
    return this.events.filter((e) => new Date(e.timestamp).toISOString().slice(0, 10) === today).length;
  }

  hasRecent(type: NotificationType, examId: string | undefined, since: number): boolean {
    return this.events.some((e) => e.type === type && e.examId === examId && e.timestamp > since);
  }
}

export class NotificationServiceV2 {
  private log: InMemoryEventLog;
  private options: NotificationThresholds;
  private storage: NotificationStorage;
  /** PluginDataStorage opcional para dedup persistente. */
  private pluginData?: PluginDataStorage;
  public onEmit: ((e: NotificationEvent) => void) | null = null;
  private nowFn: () => number = Date.now;
  /** Si está en focus mode, no emite nada. */
  private inFocusMode: () => boolean = () => false;

  constructor(
    options: Partial<NotificationThresholds> = {},
    storage: NotificationStorage,
    pluginData?: PluginDataStorage
  ) {
    this.options = { ...DEFAULT_THRESHOLDS, ...options };
    this.storage = storage;
    this.pluginData = pluginData;
    this.log = new InMemoryEventLog(storage);
  }

  setFocusChecker(fn: () => boolean): void {
    this.inFocusMode = fn;
  }

  // ─── Detección ────────────────────────────────────────

  detectAdherenceDrops(exams: Exam[]): NotificationEvent[] {
    if (this.inFocusMode()) return [];
    const out: NotificationEvent[] = [];
    const since = this.nowFn() - this.options.dedupHours * 3600 * 1000;
    for (const exam of exams) {
      if (exam.status !== "active" || !exam.schedule) continue;
      const records = this.recordsForExam(exam);
      if (records.length < 2) continue;
      const recent = recentAdherence(records, 3);
      if (recent < this.options.adherenceDropThreshold) {
        if (this.log.hasRecent("adherence-drop", exam.id, since)) continue;
        const severity: NotificationSeverity = recent < 0.3 ? "urgent" : "warning";
        out.push(this.makeEvent({
          type: "adherence-drop",
          title: `📉 Adherencia baja en "${exam.title}"`,
          message: `Solo ${(recent * 100).toFixed(0)}% en los últimos 3 días. Toca ponerse las pilas.`,
          examId: exam.id,
          severity,
          meta: { recentAdherence: recent },
        }));
      }
    }
    return out;
  }

  detectStreakMilestone(currentStreak: number, milestonesReached: number[]): NotificationEvent | null {
    if (this.inFocusMode()) return null;
    for (const m of this.options.streakMilestones) {
      if (currentStreak >= m && !milestonesReached.includes(m)) {
        return this.makeEvent({
          type: "streak-milestone",
          title: getMilestoneMessage(m, currentStreak),
          message: `Llevas ${currentStreak} días seguidos estudiando.`,
          severity: "info",
          meta: { milestone: m, streak: currentStreak },
        });
      }
    }
    return null;
  }

  detectStreakAtRisk(currentStreak: number, isAtRisk: boolean, isActive: boolean): NotificationEvent | null {
    if (this.inFocusMode()) return null;
    if (!this.options.alertStreakAtRisk) return null;
    if (!isAtRisk || isActive || currentStreak < 2) return null;
    const since = this.nowFn() - 18 * 3600 * 1000;
    if (this.log.hasRecent("streak-at-risk", undefined, since)) return null;
    return this.makeEvent({
      type: "streak-at-risk",
      title: `⚠️ Tu racha de ${currentStreak} días está en riesgo`,
      message: `Estudia al menos 1 card hoy para no perderla.`,
      severity: "warning",
      meta: { streak: currentStreak },
    });
  }

  detectExamApproaching(exams: Exam[]): NotificationEvent[] {
    if (this.inFocusMode()) return [];
    const out: NotificationEvent[] = [];
    const since = this.nowFn() - this.options.dedupHours * 3600 * 1000;
    // Comparar fechas como strings "YYYY-MM-DD" para evitar desfases por timezone.
    const todayStr = this.dateStringOnly(new Date(this.nowFn()));
    for (const exam of exams) {
      if (exam.status !== "active") continue;
      const examDateStr = this.dateStringOnly(new Date(exam.date));
      const daysUntil = this.daysBetweenStrings(todayStr, examDateStr);
      if (daysUntil < 0 || daysUntil > 30) continue;
      // Notificar si daysUntil=0 (HOY) o si está en la lista configurada
      const shouldNotify = daysUntil === 0 || this.options.examApproachingDays.includes(daysUntil);
      if (!shouldNotify) continue;
      if (this.log.hasRecent("exam-approaching", exam.id, since)) continue;
      const severity: NotificationSeverity = daysUntil <= 1 ? "urgent" : daysUntil <= 3 ? "warning" : "info";
      out.push(this.makeEvent({
        type: "exam-approaching",
        title: daysUntil === 0
          ? `🎯 "${exam.title}" es HOY`
          : `📅 "${exam.title}" en ${daysUntil} día${daysUntil === 1 ? "" : "s"}`,
        message: daysUntil === 0
          ? `¡Es el día! Repasa las últimas cards del plan.`
          : `Faltan ${daysUntil} días. Plan: ${exam.schedule?.totalCards ?? 0} cards.`,
        examId: exam.id,
        severity,
        meta: { daysUntil, examDate: exam.date },
      }));
    }
    return out;
  }

  detectOverloadedDays(exams: Exam[]): NotificationEvent[] {
    if (this.inFocusMode()) return [];
    const out: NotificationEvent[] = [];
    const since = this.nowFn() - this.options.dedupHours * 3600 * 1000;
    for (const exam of exams) {
      if (exam.status !== "active" || !exam.schedule) continue;
      const overloaded = exam.schedule.days.filter((d) => d.overloaded);
      if (overloaded.length === 0) continue;
      if (this.log.hasRecent("exam-overloaded", exam.id, since)) continue;
      out.push(this.makeEvent({
        type: "exam-overloaded",
        title: `⚠️ Días sobrecargados en "${exam.title}"`,
        message: `${overloaded.length} día(s) exceden el cap diario. Considera redistribuir.`,
        examId: exam.id,
        severity: "warning",
        meta: { overloadedDays: overloaded.length },
      }));
    }
    return out;
  }

  detectRebalanceNeeded(exams: Exam[]): NotificationEvent[] {
    if (this.inFocusMode()) return [];
    const out: NotificationEvent[] = [];
    const since = this.nowFn() - 48 * 3600 * 1000;
    for (const exam of exams) {
      if (exam.status !== "active" || !exam.schedule) continue;
      const records = this.recordsForExam(exam);
      if (records.length < 3) continue;
      const recent = recentAdherence(records, 3);
      if (recent >= 0.5) continue;
      if (this.log.hasRecent("plan-requires-rebalance", exam.id, since)) continue;
      out.push(this.makeEvent({
        type: "plan-requires-rebalance",
        title: `🔄 Plan de "${exam.title}" necesita rebalanceo`,
        message: `Adherencia ${(recent * 100).toFixed(0)}%. Considera reducir scope o mover la fecha.`,
        examId: exam.id,
        severity: "urgent",
        meta: { recentAdherence: recent },
      }));
    }
    return out;
  }

  /** v0.20: notifica cuando un goal se completa. */
  notifyGoalCompleted(goalId: string, title: string, summary: string): NotificationEvent | null {
    if (this.inFocusMode()) return null;
    const since = this.nowFn() - 24 * 3600 * 1000;
    if (this.log.hasRecent("goal-completed", goalId, since)) return null;
    const event: NotificationEvent = {
      id: `goal-completed-${goalId}-${this.nowFn()}`,
      type: "goal-completed",
      title: `🎯 ${title}`,
      message: summary,
      timestamp: this.nowFn(),
      severity: "info",
      shown: false,
      meta: { goalId },
    };
    return this.emit(event);
  }

  /** v0.20: notifica que el weekly review está listo. */
  notifyWeeklyReviewReady(weekStart: string, weekEnd: string): NotificationEvent | null {
    if (this.inFocusMode()) return null;
    const since = this.nowFn() - 7 * 24 * 3600 * 1000;
    if (this.log.hasRecent("weekly-review-ready", undefined, since)) return null;
    return this.emit({
      id: `weekly-review-${weekStart}-${this.nowFn()}`,
      type: "weekly-review-ready",
      title: "📊 Tu resumen semanal está listo",
      message: `Semana ${weekStart} → ${weekEnd}. Revisa tus estadísticas.`,
      timestamp: this.nowFn(),
      severity: "info",
      shown: false,
      meta: { weekStart, weekEnd },
    });
  }

  // ─── Emisión ─────────────────────────────────────────

  emitBatch(events: NotificationEvent[]): NotificationEvent[] {
    if (this.inFocusMode()) return [];
    const todayCount = this.log.todayCount(this.nowFn());
    const remaining = Math.max(0, this.options.maxPerDay - todayCount);
    const toEmit = events.slice(0, remaining);
    for (const e of toEmit) {
      this.log.add(e);
      this.onEmit?.(e);
    }
    return toEmit;
  }

  emit(event: NotificationEvent): NotificationEvent | null {
    if (this.inFocusMode()) return null;
    const todayCount = this.log.todayCount(this.nowFn());
    if (todayCount >= this.options.maxPerDay) return null;
    this.log.add(event);
    this.onEmit?.(event);
    return event;
  }

  // ─── Acceso ───────────────────────────────────────────

  getRecent(limit = 50): NotificationEvent[] {
    return this.log.recent(limit);
  }

  getUnshown(): NotificationEvent[] {
    return this.log.unshown();
  }

  markShown(ids: string[]): void {
    this.log.markShown(ids);
  }

  prune(): void {
    const cutoff = this.nowFn() - 30 * 24 * 3600 * 1000;
    this.log.prune(cutoff);
  }

  clear(): void {
    // No podemos limpiar el log de InMemoryEventLog fácilmente, recargamos
    this.log = new InMemoryEventLog({ read: () => null, write: () => {} });
  }

  // ─── Internals ────────────────────────────────────────

  private makeEvent(partial: Omit<NotificationEvent, "id" | "timestamp" | "shown">): NotificationEvent {
    const key = `${partial.type}-${partial.examId ?? "global"}`;
    const id = `${key}-${this.nowFn()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      timestamp: this.nowFn(),
      shown: false,
      ...partial,
    };
  }

  private recordsForExam(exam: Exam): AdherenceRecord[] {
    // El caller (Monitor) pasa los records si los tiene; aquí devolvemos [].
    // En producción, el monitor debería usar el AdherenceStore.
    return [];
  }

  private parseDateOnly(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Devuelve "YYYY-MM-DD" de una fecha en local time. */
  private dateStringOnly(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Calcula días entre dos strings "YYYY-MM-DD" sin desfase de timezone. */
  private daysBetweenStrings(fromStr: string, toStr: string): number {
    const [fy, fm, fd] = fromStr.split("-").map(Number);
    const [ty, tm, td] = toStr.split("-").map(Number);
    const from = Date.UTC(fy, fm - 1, fd);
    const to = Date.UTC(ty, tm - 1, td);
    return Math.round((to - from) / 86_400_000);
  }

  setNow(fn: () => number): void {
    this.nowFn = fn;
  }

  getOptions(): NotificationThresholds {
    return { ...this.options };
  }

  /** Para tests. */
  _logForTest(): NotificationEvent[] {
    return this.log.all();
  }
}

/** Helper: ejecuta todas las detecciones. */
export function detectAllV2(
  service: NotificationServiceV2,
  exams: Exam[],
  streak: { current: number; milestonesReached: number[]; isActive: boolean; isAtRisk: boolean }
): NotificationEvent[] {
  const all: NotificationEvent[] = [];
  all.push(...service.detectAdherenceDrops(exams));
  all.push(...service.detectExamApproaching(exams));
  all.push(...service.detectOverloadedDays(exams));
  all.push(...service.detectRebalanceNeeded(exams));
  const milestone = service.detectStreakMilestone(streak.current, streak.milestonesReached);
  if (milestone) all.push(milestone);
  const atRisk = service.detectStreakAtRisk(streak.current, streak.isAtRisk, streak.isActive);
  if (atRisk) all.push(atRisk);
  return all;
}
