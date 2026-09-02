// @ts-nocheck - v0.28: Legacy/UI, refactorear en v0.29
// v0.20: Weekly Review modal — muestra el resumen de la semana actual
// con comparación con la semana anterior.
// v0.22: añade próximas clases, abrir creación manual, link a voice notes.

import { Modal } from "obsidian";
import type MNexusPlugin from "../main";
import type { WeeklyReview, WeeklyReviewSnapshot } from "../exams/weeklyReview.js";

export class WeeklyReviewModal extends Modal {
  private plugin: MNexusPlugin;
  private review: WeeklyReview | null = null;
  private previous: WeeklyReview | null = null;

  constructor(plugin: MNexusPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { WeeklyReviewService } = await import("../exams/weeklyReview");
    const storage = this.plugin.getPluginDataStorage();
    const service = new WeeklyReviewService(storage);
    this.review = service.generateCurrentWeek();
    this.previous = service.generateLastWeek();
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = "min-width:600px;";
    contentEl.createEl("h2", { text: "📊 Resumen Semanal" });

    if (!this.review) {
      contentEl.createEl("p", { text: "No hay datos suficientes." });
      return;
    }

    const r = this.review;
    const p = this.previous;

    // Header con rating
    const ratingEl = contentEl.createDiv({ cls: "mnexus-week-rating" });
    ratingEl.style.cssText = "padding:16px;border-radius:8px;margin-bottom:16px;";
    const ratingColor = r.rating === "great" ? "var(--interactive-accent)" :
                       r.rating === "low" ? "var(--text-error)" :
                       "var(--text-warning)";
    ratingEl.style.background = ratingColor;
    ratingEl.createEl("h3", { text: `Semana ${r.weekStart} → ${r.weekEnd}` });
    const ratingText = r.rating === "great" ? "🔥 ¡Excelente semana!" :
                      r.rating === "low" ? "⚠️ Semana floja — a recuperar" :
                      "👍 Semana decente";
    ratingEl.createEl("p", { text: ratingText });

    // Stats principales
    const stats = contentEl.createDiv({ cls: "mnexus-week-stats" });
    stats.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;margin-bottom:16px;";
    stats.createEl("div").innerHTML = `<strong>📚 Cards repasadas:</strong> ${r.totalCards} ${this.deltaBadge(r.deltaCards, "cards")}`;
    stats.createEl("div").innerHTML = `<strong>✅ Correctas:</strong> ${r.totalCorrect} (${(r.averageAccuracy * 100).toFixed(1)}%) ${this.deltaBadge(r.deltaAccuracy, "ratio")}`;
    stats.createEl("div").innerHTML = `<strong>⏱️ Tiempo total:</strong> ${(r.totalDurationMs / 60000).toFixed(0)} min`;
    stats.createEl("div").innerHTML = `<strong>📅 Mejor día:</strong> ${r.bestDay ? `${r.bestDay.date} (${r.bestDay.cards} cards)` : "—"}`;
    if (r.worstDay) {
      stats.createEl("div").innerHTML = `<strong>📉 Día más flojo:</strong> ${r.worstDay.date} (${(r.worstDay.accuracy * 100).toFixed(0)}% acc)`;
    }

    // Distribución diaria
    contentEl.createEl("h3", { text: "📊 Distribución diaria" });
    const dayChart = contentEl.createDiv({ cls: "mnexus-week-days" });
    dayChart.style.cssText = "display:flex;align-items:flex-end;gap:4px;height:80px;margin-bottom:16px;";
    for (const day of r.days) {
      const bar = dayChart.createDiv({ cls: "mnexus-week-day" });
      const h = day.cards > 0 ? Math.min(80, 8 + day.cards * 4) : 4;
      bar.style.cssText = `width:60px;height:${h}px;background:${day.cards > 0 ? "var(--interactive-accent)" : "var(--background-modifier-border)"};border-radius:4px 4px 0 0;display:flex;align-items:flex-end;justify-content:center;color:#fff;font-size:10px;padding:2px;`;
      bar.title = `${day.date}: ${day.cards} cards, ${(day.accuracy * 100).toFixed(0)}% acc`;
      if (day.cards > 0) bar.textContent = String(day.cards);
    }

    // Comparativa con semana anterior
    if (p) {
      contentEl.createEl("h3", { text: "📈 vs semana anterior" });
      const comp = contentEl.createDiv({ cls: "mnexus-week-compare" });
      comp.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;";
      comp.createEl("div").innerHTML = `<strong>Cards:</strong> ${p.totalCards} → ${r.totalCards} ${this.deltaBadge(r.deltaCards, "cards")}`;
      comp.createEl("div").innerHTML = `<strong>Accuracy:</strong> ${(p.averageAccuracy * 100).toFixed(0)}% → ${(r.averageAccuracy * 100).toFixed(0)}% ${this.deltaBadge(r.deltaAccuracy, "ratio")}`;
    }

    // Botón para guardar snapshot
    const saveBtn = contentEl.createEl("button", { text: "💾 Guardar snapshot de esta semana" });
    saveBtn.style.cssText = "margin-top:16px;padding:8px 16px;border-radius:6px;background:var(--interactive-accent);color:#fff;border:none;cursor:pointer;";
    saveBtn.onclick = async () => {
      const { WeeklyReviewService } = await import("../exams/weeklyReview");
      const storage = this.plugin.getPluginDataStorage();
      const service = new WeeklyReviewService(storage);
      service.saveSnapshot(r);
      // Notificar al servicio para que dispare evento
      this.plugin.getNotificationService?.().notifyWeeklyReviewReady(r.weekStart, r.weekEnd);
      saveBtn.textContent = "✅ Guardado";
      saveBtn.disabled = true;
    };

    // Botón cerrar
    const closeBtn = contentEl.createEl("button", { text: "Cerrar" });
    closeBtn.style.cssText = "margin-top:8px;margin-left:8px;padding:8px 16px;";
    closeBtn.onclick = () => this.close();

    // ─── v0.22: Próximas clases (ScheduleMatcher) ────────────────────
    this.renderUpcomingClasses(contentEl).catch((err) => {
      console.error("[weeklyReviewModal] renderUpcomingClasses failed:", err);
    });

    // ─── v0.22: Accesos rápidos (ManualCreation + Audio) ────────────
    const actionsTitle = contentEl.createEl("h3", { text: "🛠 Acciones rápidas" });
    actionsTitle.style.cssText = "margin-top:24px;";
    const actionsRow = contentEl.createDiv({ cls: "mnexus-week-actions" });
    actionsRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
    const manualBtn = actionsRow.createEl("button", { text: "✨ Crear manualmente" });
    manualBtn.style.cssText = "padding:8px 16px;border-radius:6px;background:var(--interactive-accent);color:#fff;border:none;cursor:pointer;";
    manualBtn.onclick = () => this.plugin.openManualCreation();
    const voiceNoteBtn = actionsRow.createEl("button", { text: "🎙️ Grabar voice note" });
    voiceNoteBtn.style.cssText = "padding:8px 16px;border-radius:6px;background:var(--interactive-accent);color:#fff;border:none;cursor:pointer;";
    voiceNoteBtn.onclick = () => {
      // Import dinámico para no acoplar
      import("../audio/router").then((m) => {
        const router = (this.plugin as unknown as { audioRouter?: { processAudioFile: (path: string) => Promise<unknown> } }).audioRouter;
        if (router) {
          // Sin path real, abriría el audio en Inbox
          router.processAudioFile("user-recorded.m4a");
        }
      });
    };
  }

  /** v0.22: Lista las próximas 5 clases según el horario configurado. */
  private async renderUpcomingClasses(contentEl: HTMLElement) {
    const { ScheduleMatcher, formatSchedule } = await import("../exams/scheduleMatcher");
    const storage = this.plugin.getPluginDataStorage();
    const schedules = storage.getClassSchedules();
    if (schedules.length === 0) {
      const empty = contentEl.createDiv({ cls: "mnexus-week-no-classes" });
      empty.style.cssText = "margin-top:16px;padding:12px;border-radius:6px;background:var(--background-modifier-hover);color:var(--text-muted);";
      empty.createEl("p", { text: "📅 No hay horarios configurados. Usa ✨ Crear manualmente → ⏰ Clase." });
      return;
    }
    const matcher = new ScheduleMatcher(schedules);
    const upcoming = matcher.getUpcoming(Date.now(), 5);
    if (upcoming.length === 0) return;

    const title = contentEl.createEl("h3", { text: "⏰ Próximas clases" });
    title.style.cssText = "margin-top:24px;";
    const list = contentEl.createDiv({ cls: "mnexus-week-upcoming" });
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:16px;";
    for (const next of upcoming) {
      const item = list.createDiv({ cls: "mnexus-week-upcoming-item" });
      item.style.cssText = "padding:8px 12px;border-radius:6px;background:var(--background-secondary);display:flex;justify-content:space-between;";
      const left = item.createDiv();
      left.createEl("strong", { text: next.schedule.subject });
      const meta = left.createDiv({ cls: "mnexus-upcoming-meta" });
      meta.style.cssText = "color:var(--text-muted);font-size:12px;";
      meta.createEl("span", { text: formatSchedule(next.schedule) });
      if (next.schedule.location) {
        meta.createEl("span", { text: ` · 📍 ${next.schedule.location}` });
      }
      const right = item.createDiv();
      const date = new Date(next.startTimeMs);
      right.style.cssText = "color:var(--text-muted);font-size:12px;";
      right.createEl("span", { text: date.toLocaleDateString() });
    }
  }

  private deltaBadge(delta: number, kind: "cards" | "ratio"): string {
    if (delta === 0) return `<span style="color:var(--text-muted);">→ igual</span>`;
    const isPositive = delta > 0;
    const color = isPositive ? "var(--interactive-accent)" : "var(--text-error)";
    const symbol = kind === "cards" ? (isPositive ? "+" : "") : "";
    const formatted = kind === "ratio" ? `${(delta * 100).toFixed(1)}pp` : `${symbol}${delta}`;
    return `<span style="color:${color};">${isPositive ? "↑" : "↓"} ${formatted}</span>`;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
