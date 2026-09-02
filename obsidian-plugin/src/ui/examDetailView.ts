// @ts-nocheck - v0.28: Legacy/UI, refactorear en v0.29
// ExamDetailView: detalle de un examen con plan día a día.
// v0.14: timeline visual, cards por día, conflictos con otros exámenes.

import { ItemView, WorkspaceLeaf } from "obsidian";
import type MNexusPlugin from "../main";
import type { Exam } from "../exams/types.js";

export const EXAM_DETAIL_VIEW_TYPE = "mnexus-exam-detail";

export class ExamDetailView extends ItemView {
  private plugin: MNexusPlugin;
  private examId: string;

  constructor(leaf: WorkspaceLeaf, plugin: MNexusPlugin, examId: string) {
    super(leaf);
    this.plugin = plugin;
    this.examId = examId;
  }

  getViewType() {
    return EXAM_DETAIL_VIEW_TYPE;
  }

  getDisplayText() {
    const exam = this.plugin.examManager.get(this.examId);
    return exam ? `Examen: ${exam.title}` : "Examen";
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
    const exam = this.plugin.examManager.get(this.examId);
    if (!exam) {
      container.createEl("p", { text: "Examen no encontrado" });
      return;
    }
    container.addClass("mnexus-exam-detail");
    const header = container.createDiv({ cls: "mnexus-exam-detail-header" });
    header.createEl("h2", { text: exam.title });
    header.createEl("p", {
      text: `${exam.subject} · ${exam.date} · ${exam.priority}`,
      cls: "mnexus-muted",
    });

    const backBtn = header.createEl("button", { text: "← Volver al dashboard" });
    backBtn.onclick = () => this.plugin.openExamDashboard();

    const editBtn = header.createEl("button", { text: "✏️ Editar" });
    editBtn.onclick = () => this.plugin.openExamModal(this.examId);

    // Plan
    if (!exam.schedule) {
      const empty = container.createDiv({ cls: "mnexus-empty" });
      empty.createEl("p", { text: "Aún no has generado un plan para este examen." });
      const btn = empty.createEl("button", { text: "🧮 Generar plan", cls: "mod-cta" });
      btn.onclick = async () => {
        const { ExamScheduler } = await import("../exams/scheduler");
        const scheduler = new ExamScheduler(this.plugin.getScopeResolver());
        const cards = this.plugin.getAllFlashcards();
        const others = this.plugin.examManager.list({ status: "active" }).filter((e) => e.id !== exam.id);
        const schedule = scheduler.generate(exam, cards, undefined, others);
        this.plugin.examManager.setSchedule(exam.id, schedule);
        this.plugin.examManager.save();
        await this.render();
      };
      return;
    }

    // Resumen
    const summary = container.createDiv({ cls: "mnexus-exam-detail-summary" });
    summary.createEl("div", { text: `📅 ${exam.schedule.daysAvailable} días disponibles` });
    summary.createEl("div", { text: `📝 ${exam.schedule.totalCards} cards a estudiar` });
    summary.createEl("div", { text: `⏰ ${exam.schedule.overdue} atrasadas` });
    summary.createEl("div", { text: `✅ ${exam.schedule.alreadyMature} ya maduras` });
    summary.createEl("div", { text: `🎯 Cobertura objetivo: ${(exam.schedule.estimatedCoverage * 100).toFixed(0)}%` });

    if (exam.schedule.warnings.length > 0) {
      const warnings = container.createDiv({ cls: "mnexus-exam-warnings" });
      warnings.createEl("h3", { text: "⚠️ Avisos" });
      for (const w of exam.schedule.warnings) {
        warnings.createEl("p", { text: w, cls: "mnexus-warning" });
      }
    }

    // Timeline
    const timeline = container.createDiv({ cls: "mnexus-exam-timeline" });
    timeline.createEl("h3", { text: "Plan día a día" });
    for (const day of exam.schedule.days) {
      const dayDiv = timeline.createDiv({ cls: "mnexus-exam-timeline-day" });
      if (day.overloaded) dayDiv.addClass("is-overloaded");
      const dayHead = dayDiv.createDiv({ cls: "mnexus-exam-timeline-head" });
      dayHead.createEl("strong", { text: this.formatDay(day.date) });
      const stats = dayHead.createDiv({ cls: "mnexus-muted" });
      stats.createEl("span", { text: `${day.cards} cards (${day.newCards} nuevas)` });
      stats.createEl("span", { text: ` · ${day.estimatedMinutes} min` });
      if (day.topics.length > 0) {
        const topics = dayDiv.createDiv({ cls: "mnexus-exam-timeline-topics" });
        for (const t of day.topics) {
          topics.createEl("span", { text: t, cls: "mnexus-topic-tag" });
        }
      }
      if (day.conflictsWith.length > 0) {
        const conflict = dayDiv.createDiv({ cls: "mnexus-exam-timeline-conflict" });
        conflict.createEl("span", { text: `⚠️ También: ${day.conflictsWith.join(", ")}` });
      }
    }
  }

  private formatDay(date: string): string {
    const d = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    const dateStr = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
    if (days === 0) return `${dateStr} (HOY)`;
    if (days < 0) return `${dateStr} (hace ${-days} días)`;
    if (days === 1) return `${dateStr} (mañana)`;
    return `${dateStr} (en ${days} días)`;
  }
}
