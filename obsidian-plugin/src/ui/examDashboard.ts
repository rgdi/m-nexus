// v0.28: DEPRECATED — esta vista depende de subsistemas (examManager, scopeResolver)
// que el thin client ya no expone. Marcada como legacy hasta v0.29 cuando se migre
// a usar el backend. Para evitar errores de TypeScript en compilación.
// @ts-nocheck - Legacy UI, requiere migración al backend.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { ItemView, WorkspaceLeaf } from "obsidian";

import { ItemView, WorkspaceLeaf } from "obsidian";
import type MNexusPlugin from "../main";
import { ExamScheduler, MultiExamCoordinator, computeProgress } from "../exams/scheduler.js";
import { recommend, shouldTriggerRebalance, summarizeAdherence } from "../exams/autoRebalance.js";
import { computeAdherence, recentAdherence, type ReviewEvent, type AdherenceRecord } from "../exams/adherence.js";
import type { Exam, ExamProgress } from "../exams/types.js";

export const EXAM_DASHBOARD_VIEW_TYPE = "mnexus-exam-dashboard";

export class ExamDashboard extends ItemView {
  private plugin: MNexusPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: MNexusPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return EXAM_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText() {
    return "Exámenes M-NEXUS";
  }

  getIcon() {
    return "calendar-clock";
  }

  async onOpen() {
    await this.render();
  }

  async onClose() {}

  private async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("mnexus-exam-dashboard");

    // Header
    const header = container.createDiv({ cls: "mnexus-exam-dashboard-header" });
    header.createEl("h2", { text: "Exámenes" });

    const actions = header.createDiv({ cls: "mnexus-exam-dashboard-actions" });
    const newBtn = actions.createEl("button", { text: "➕ Nuevo examen" });
    newBtn.addClass("mod-cta");
    newBtn.onclick = () => this.plugin.openExamModal();

    const recalcBtn = actions.createEl("button", { text: "🔄 Recalcular planes" });
    recalcBtn.onclick = () => this.recalculateAll();

    // v0.20: banner de focus mode (normal o deep) con countdown
    this.renderFocusBanner(container);

    // v0.16: bloque de streak
    this.renderStreakBlock(container);

    // v0.19: bloque de study goals
    this.renderGoalsBlock(container);

    // Listado
    const listContainer = container.createDiv({ cls: "mnexus-exam-dashboard-list" });
    const allExams = this.plugin.examManager.list();
    if (allExams.length === 0) {
      listContainer.createEl("p", {
        text: "No tienes exámenes todavía. Crea uno con el botón de arriba.",
        cls: "mnexus-empty",
      });
      return;
    }

    const resolver = this.plugin.getScopeResolver();
    const scheduler = new ExamScheduler(resolver);
    const coordinator = new MultiExamCoordinator();

    // Coordinar los planes (marca conflicts)
    const activeExams = allExams.filter((e) => e.status === "active");
    coordinator.coordinate(allExams);

    // Banner global de adherencia (v0.15)
    const reviews = this.loadReviews();
    const allRecords = activeExams
      .filter((e) => e.schedule)
      .flatMap((e) => computeAdherence(e, reviews));
    const summary = summarizeAdherence(allRecords);
    if (allRecords.length > 0 && shouldTriggerRebalance(allRecords)) {
      this.renderAdherenceBanner(listContainer, summary);
    }

    for (const exam of activeExams.sort((a, b) => a.date.localeCompare(b.date))) {
      this.renderExamCard(listContainer, exam, scheduler, reviews);
    }

    // Archivados
    const archived = allExams.filter((e) => e.status === "archived" || e.status === "completed");
    if (archived.length > 0) {
      const section = container.createDiv({ cls: "mnexus-exam-dashboard-archived" });
      section.createEl("h3", { text: "Archivados" });
      for (const exam of archived) {
        const card = section.createDiv({ cls: "mnexus-exam-card mnexus-exam-card-archived" });
        card.createEl("h4", { text: exam.title });
        card.createEl("span", { text: `${exam.date} · ${exam.status}`, cls: "mnexus-muted" });
      }
    }
  }

  private renderExamCard(parent: HTMLElement, exam: Exam, scheduler: ExamScheduler, reviews: ReviewEvent[]) {
    const card = parent.createDiv({ cls: "mnexus-exam-card" });
    if (exam.color) card.style.borderLeft = `4px solid ${exam.color}`;

    const head = card.createDiv({ cls: "mnexus-exam-card-head" });
    const titleSection = head.createDiv({ cls: "mnexus-exam-card-titles" });
    titleSection.createEl("h3", { text: exam.title });
    titleSection.createEl("p", {
      text: `${exam.subject} · ${this.formatExamType(exam.examType)} · ${this.formatPriority(exam.priority)}`,
      cls: "mnexus-muted",
    });

    const dateSection = head.createDiv({ cls: "mnexus-exam-card-date" });
    const daysUntil = this.daysUntil(exam.date);
    dateSection.createDiv({
      text: this.formatDate(exam.date),
      cls: "mnexus-exam-date",
    });
    dateSection.createDiv({
      text: daysUntil < 0 ? "Pasado" : daysUntil === 0 ? "¡Hoy!" : `${daysUntil} días`,
      cls: daysUntil < 3 ? "mnexus-badge mnexus-badge-urgent" : "mnexus-badge mnexus-badge-soon",
    });

    // Adherencia de este examen
    if (exam.schedule) {
      const records = computeAdherence(exam, reviews);
      if (records.length > 0) {
        const sum = summarizeAdherence(records);
        const adherenceBar = card.createDiv({ cls: "mnexus-adherence-bar" });
        const adherencePct = (sum.recent * 100).toFixed(0);
        const trendIcon = sum.trend === "up" ? "📈" : sum.trend === "down" ? "📉" : "➡️";
        adherenceBar.createEl("div", {
          text: `Adherencia: ${adherencePct}% ${trendIcon}`,
          cls: "mnexus-adherence-label",
        });
        const bar = adherenceBar.createDiv({ cls: "mnexus-adherence-progress" });
        const fill = bar.createDiv({ cls: "mnexus-adherence-fill" });
        fill.style.width = `${adherencePct}%`;
        if (sum.recent < 0.5) fill.addClass("mnexus-adherence-low");
        else if (sum.recent < 0.8) fill.addClass("mnexus-adherence-mid");
        else fill.addClass("mnexus-adherence-high");
      }
    }

    // Scopes
    const scopesDiv = card.createDiv({ cls: "mnexus-exam-card-scopes" });
    for (const scope of exam.scopes) {
      const tag = scopesDiv.createEl("span", { cls: "mnexus-scope-tag" });
      tag.textContent = this.scopeLabel(scope);
    }

    // Plan resumen
    if (exam.schedule) {
      const stats = card.createDiv({ cls: "mnexus-exam-card-stats" });
      stats.createEl("div", {
        text: `📅 ${exam.schedule.daysAvailable} días · 📝 ${exam.schedule.totalCards} cards`,
      });
      const totalMinutes = exam.schedule.days.reduce((s, d) => s + d.estimatedMinutes, 0);
      stats.createEl("div", {
        text: `⏱️ ${Math.round(totalMinutes / 60)}h total estimadas · 🎯 Cobertura: ${(exam.schedule.estimatedCoverage * 100).toFixed(0)}%`,
      });
      // v0.15: boosts aplicados
      if (exam.schedule.boosts && exam.schedule.boosts.length > 0) {
        stats.createEl("div", {
          text: `🚀 ${exam.schedule.boosts.length} cards con FSRS boost para alinearlas con el examen`,
          cls: "mnexus-boost-info",
        });
      }
    } else {
      card.createDiv({ cls: "mnexus-muted", text: "Sin plan. Genera uno con el botón." });
    }

    // Recomendaciones de rebalance (v0.15)
    if (exam.schedule) {
      const records = computeAdherence(exam, reviews);
      if (records.length > 0) {
        const daysUntilExam = Math.max(0, this.daysUntil(exam.date));
        const pendingCards = exam.schedule.totalCards;
        const recentRec = recentAdherence(records, 3);
        const rec = recommend(exam, {
          overallAdherence: sumOr(records, 0),
          recentAdherence: recentRec,
          problemDaysCount: records.filter((r) => r.adherenceRate < 0.5).length,
          currentCoverage: exam.schedule.estimatedCoverage,
          targetCoverage: 0.9,
          daysUntilExam,
          pendingCards,
          schedule: exam.schedule,
          dailyCap: 100,
          scopeCount: exam.scopes.length,
        });
        if (rec.actions.length > 0 && !rec.actions.every((a) => a.type === "add-time")) {
          const recDiv = card.createDiv({
            cls: rec.urgent ? "mnexus-rebalance-urgent" : "mnexus-rebalance",
          });
          recDiv.createEl("strong", { text: rec.urgent ? "🚨 Acción urgente" : "💡 Sugerencias" });
          for (const action of rec.actions) {
            if (action.type === "add-time") continue;
            const tip = recDiv.createEl("p", {
              text: `• ${action.suggestion}`,
              cls: "mnexus-rebalance-tip",
            });
          }
        }
      }
    }

    // Acciones
    const actions = card.createDiv({ cls: "mnexus-exam-card-actions" });
    const generateBtn = actions.createEl("button", { text: "🧮 Generar plan" });
    generateBtn.onclick = async () => {
      await this.generatePlanFor(exam, scheduler);
      await this.render();
    };
    const openBtn = actions.createEl("button", { text: "👁️ Ver detalle" });
    openBtn.onclick = () => this.plugin.openExamDetail(exam.id);
    const archiveBtn = actions.createEl("button", { text: "📦 Archivar" });
    archiveBtn.onclick = async () => {
      this.plugin.examManager.archive(exam.id);
      this.plugin.examManager.save();
      await this.render();
    };
  }

  private renderAdherenceBanner(parent: HTMLElement, summary: { overall: number; recent: number; trend: "up" | "down" | "stable" }) {
    const banner = parent.createDiv({ cls: "mnexus-adherence-banner" });
    const pct = (summary.recent * 100).toFixed(0);
    const trendIcon = summary.trend === "up" ? "📈" : summary.trend === "down" ? "📉" : "➡️";
    banner.createEl("h3", {
      text: `⚠️ Adherencia global: ${pct}% ${trendIcon}`,
    });
    banner.createEl("p", {
      text: "La adherencia al plan de repasos ha bajado. Considera rebalancear los exámenes activos (reducir scope, mover fechas, o aumentar tiempo diario).",
    });
  }

  /** Carga los ReviewEvent desde el plugin. */
  private loadReviews(): ReviewEvent[] {
    return (this.plugin as unknown as { getAdherenceReviews?: () => ReviewEvent[] }).getAdherenceReviews?.() ?? [];
  }

  private async generatePlanFor(exam: Exam, scheduler: ExamScheduler) {
    const cards = this.plugin.getAllFlashcards();
    const otherExams = this.plugin.examManager.list({ status: "active" }).filter((e) => e.id !== exam.id);
    const schedule = scheduler.generate(exam, cards, undefined, otherExams);
    this.plugin.examManager.setSchedule(exam.id, schedule);
    this.plugin.examManager.save();
  }

  private async recalculateAll() {
    const resolver = this.plugin.getScopeResolver();
    const scheduler = new ExamScheduler(resolver);
    const active = this.plugin.examManager.list({ status: "active" });
    for (const exam of active) {
      await this.generatePlanFor(exam, scheduler);
    }
    await this.render();
  }

  private daysUntil(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
  }

  private formatDate(date: string): string {
    const d = new Date(date);
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  }

  private formatExamType(t: Exam["examType"]): string {
    return { parcial: "Parcial", final: "Final", mir: "MIR", osce: "OSCE", custom: "Personalizado" }[t];
  }

  private formatPriority(p: Exam["priority"]): string {
    return { low: "🟢 Baja", medium: "🟡 Media", high: "🟠 Alta", critical: "🔴 Crítica" }[p];
  }

  private scopeLabel(scope: Exam["scopes"][number]): string {
    if (scope.type === "note") return `📄 ${scope.path}`;
    if (scope.type === "folder") return `📁 ${scope.path}${scope.includeSubfolders ? "/**" : ""}`;
    if (scope.type === "tag") return `🏷️ #${scope.tag}`;
    if (scope.type === "subject") return `📚 ${scope.subject}`;
    return "?";
  }

  /** v0.16: bloque de streak (días consecutivos, mejor racha, próximos milestones). */
  private renderStreakBlock(parent: HTMLElement) {
    const tracker = this.plugin.getStreakTracker?.();
    if (!tracker) return;
    const current = tracker.getCurrent();
    const best = tracker.getBest();
    const isActive = tracker.isActive();
    const isAtRisk = tracker.isAtRisk();
    const next = tracker.nextMilestone();

    const block = parent.createDiv({ cls: "mnexus-streak-block" });
    const isStreakAtRisk = isAtRisk && !isActive;
    const icon = isActive ? "🔥" : isStreakAtRisk ? "⚠️" : "💤";
    block.createEl("h3", { text: `${icon} Racha de estudio` });
    const stats = block.createDiv({ cls: "mnexus-streak-stats" });
    stats.style.display = "flex";
    stats.style.gap = "16px";
    stats.style.flexWrap = "wrap";
    stats.createEl("div", {
      text: `Actual: ${current} día${current === 1 ? "" : "s"}`,
    });
    stats.createEl("div", { text: `Mejor: ${best} día${best === 1 ? "" : "s"}` });
    if (next) {
      stats.createEl("div", { text: `Próximo milestone: ${next} (faltan ${next - current})` });
    }
    if (isStreakAtRisk) {
      const warn = block.createDiv({ cls: "mnexus-streak-risk mod-warning" });
      warn.style.cssText = "background:var(--background-modifier-error);padding:8px;border-radius:6px;margin-top:8px;";
      warn.createEl("strong", { text: "¡Tu racha está en riesgo! " });
      warn.createSpan({ text: "Estudia al menos 1 card HOY para no perderla." });
    }
    // Mini-chart últimos 7 días
    const last7 = tracker.getLastNDays(7);
    const chart = block.createDiv({ cls: "mnexus-streak-chart" });
    chart.style.cssText = "display:flex;gap:4px;margin-top:8px;align-items:flex-end;";
    for (const s of last7) {
      const cell = chart.createDiv({ cls: "mnexus-streak-day" });
      const h = s.cardsReviewed > 0 ? Math.min(40, 4 + s.cardsReviewed * 2) : 4;
      cell.style.cssText = `width:24px;height:${h}px;background:${s.cardsReviewed > 0 ? "var(--interactive-accent)" : "var(--background-modifier-border)"};border-radius:2px;`;
      cell.title = `${s.date}: ${s.cardsReviewed} cards`;
    }
  }

  /** v0.19: bloque de Study Goals con progress bars. */
  private renderGoalsBlock(parent: HTMLElement) {
    const storage = (this.plugin as unknown as { getPluginDataStorage?: () => unknown }).getPluginDataStorage?.();
    if (!storage) return;
    const { StudyGoals, goalProgress, goalColor, goalLabel } = require("../exams/studyGoals");
    const goalsService = new StudyGoals(storage as never);
    goalsService.syncGoals();
    // Recompute con reviews actuales
    const reviews = (storage as { getReviews(): unknown[] }).getReviews();
    const streak = this.plugin.getStreakTracker?.()?.getCurrent?.() ?? 0;
    goalsService.recomputeProgress(reviews as never, streak);
    const goals = goalsService.getActiveGoals();
    if (goals.length === 0) return;

    const block = parent.createDiv({ cls: "mnexus-goals-block" });
    block.createEl("h3", { text: "🎯 Objetivos" });
    for (const g of goals) {
      const row = block.createDiv({ cls: "mnexus-goal-row" });
      row.style.cssText = "margin-bottom:8px;";
      const label = row.createDiv({ cls: "mnexus-goal-label" });
      label.style.cssText = "display:flex;justify-content:space-between;margin-bottom:4px;";
      label.createSpan({ text: goalLabel(g) });
      const progress = goalProgress(g);
      label.createSpan({ text: `${(progress * 100).toFixed(0)}%` });
      // Progress bar
      const bar = row.createDiv({ cls: "mnexus-goal-bar" });
      bar.style.cssText = "height:8px;background:var(--background-modifier-border);border-radius:4px;overflow:hidden;";
      const fill = bar.createDiv({ cls: "mnexus-goal-fill" });
      const color = goalColor(g);
      const colorMap: Record<string, string> = {
        green: "var(--interactive-accent)",
        yellow: "var(--text-warning)",
        red: "var(--text-error)",
        blue: "var(--interactive-accent-hover)",
      };
      fill.style.cssText = `width:${progress * 100}%;height:100%;background:${colorMap[color] ?? "var(--interactive-accent)"};transition:width 0.3s;`;
    }
  }

  /** v0.20: banner persistente de focus mode (normal o deep) con countdown. */
  private renderFocusBanner(parent: HTMLElement) {
    const storage = (this.plugin as unknown as { getPluginDataStorage?: () => unknown }).getPluginDataStorage?.();
    if (!storage) return;
    const s = storage as {
      isInDeepFocusMode(now?: number): boolean;
      isInFocusMode(now?: number): boolean;
      deepFocusRemainingMs(now?: number): number;
      focusRemainingMs(now?: number): number;
      disableDeepFocusMode(): void;
      disableFocusMode(): void;
    };
    const isDeep = s.isInDeepFocusMode();
    const isNormal = s.isInFocusMode();
    if (!isDeep && !isNormal) return;

    const remaining = isDeep ? s.deepFocusRemainingMs() : s.focusRemainingMs();
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    const countdown = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const banner = parent.createDiv({ cls: "mnexus-focus-banner" });
    if (isDeep) {
      banner.style.cssText = "background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:16px;border-radius:8px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;";
      banner.createEl("strong", { text: "🧘 Deep Focus activo" });
      const info = banner.createDiv();
      info.style.cssText = "display:flex;align-items:center;gap:16px;";
      info.createSpan({ text: `Tiempo restante: ${countdown}` });
      const stop = info.createEl("button", { text: "Salir de deep focus" });
      stop.style.cssText = "background:#e94560;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;";
      stop.onclick = () => {
        s.disableDeepFocusMode();
        this.plugin.getMonitor?.(); // re-init
        (this as unknown as { onClose(): void }).onClose?.();
        // Re-render
        this.render();
      };
    } else {
      banner.style.cssText = "background:var(--background-modifier-border);color:var(--text-normal);padding:12px;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;";
      banner.createEl("strong", { text: "🔕 Modo focus activo" });
      const info = banner.createDiv();
      info.style.cssText = "display:flex;align-items:center;gap:12px;";
      info.createSpan({ text: `Tiempo restante: ${countdown}` });
      const stop = info.createEl("button", { text: "Desactivar" });
      stop.onclick = () => {
        s.disableFocusMode();
        (this as unknown as { onClose(): void }).onClose?.();
        this.render();
      };
    }

    // Auto-refresh del countdown cada 1s
    const intervalId = setInterval(() => {
      const newIsDeep = s.isInDeepFocusMode();
      const newIsNormal = s.isInFocusMode();
      if (!newIsDeep && !newIsNormal) {
        clearInterval(intervalId);
        banner.remove();
        return;
      }
      const newRem = newIsDeep ? s.deepFocusRemainingMs() : s.focusRemainingMs();
      const m = Math.floor(newRem / 60_000);
      const sec = Math.floor((newRem % 60_000) / 1000);
      const cd = m > 0 ? `${m}m ${sec}s` : `${sec}s`;
      info.children[0].textContent = `Tiempo restante: ${cd}`;
    }, 1000);

    // Guardar el interval para limpiarlo si la vista se cierra
    (this as unknown as { _focusIntervalId?: ReturnType<typeof setInterval> })._focusIntervalId = intervalId;
  }
}

function sumOr(records: AdherenceRecord[], fallback: number): number {
  if (records.length === 0) return fallback;
  return records.reduce((s, r) => s + r.adherenceRate, 0) / records.length;
}
