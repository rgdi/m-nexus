// Modal del calendario: muestra los próximos exámenes detectados, permite
// previsualizar matches y forzar el sync.

import { App, Modal } from "obsidian";
import { ExamMatch } from "../types";
import { CalendarSync } from "../calendar/sync";

export class CalendarModal extends Modal {
  constructor(
    app: App,
    private sync: CalendarSync,
    private matches?: ExamMatch[]
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "500px";
    contentEl.createEl("h2", { text: "Sincronización de calendario" });

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.marginBottom = "12px";
    const previewBtn = actions.createEl("button", { text: "👁 Vista previa" });
    const applyBtn = actions.createEl("button", { text: "🔄 Aplicar ahora" });

    const list = contentEl.createDiv();
    const render = (matches: ExamMatch[]) => {
      list.empty();
      if (matches.length === 0) {
        list.createEl("p", { text: "No se detectaron exámenes. Configura URLs ICS en Ajustes.", cls: "mnexus-label" });
        return;
      }
      for (const m of matches) {
        const card = list.createDiv({ cls: "mnexus-coverage-alert" });
        const head = card.createDiv();
        head.createEl("strong", { text: m.event.summary });
        const meta = card.createDiv({ cls: "mnexus-label" });
        meta.createEl("span", { text: `${m.event.start.toLocaleDateString()} · materia: ${m.subject} · confianza: ${m.confidence}` });
        if (m.event.location) meta.createEl("div", { text: `📍 ${m.event.location}` });
        if (m.event.description) {
          const d = card.createEl("div", { text: m.event.description });
          d.style.fontSize = "0.85em";
          d.style.color = "var(--text-muted)";
        }
      }
    };

    previewBtn.onclick = async () => {
      previewBtn.textContent = "Cargando…";
      try {
        const matches = await this.sync.preview();
        render(matches);
      } catch (e) {
        list.createEl("p", { text: "Error: " + (e as Error).message, cls: "mnexus-label" });
      } finally {
        previewBtn.textContent = "👁 Vista previa";
      }
    };

    applyBtn.onclick = async () => {
      applyBtn.textContent = "Sincronizando…";
      try {
        const matches = await this.sync.refresh();
        render(matches);
      } catch (e) {
        list.createEl("p", { text: "Error: " + (e as Error).message, cls: "mnexus-label" });
      } finally {
        applyBtn.textContent = "🔄 Aplicar ahora";
      }
    };

    if (this.matches) render(this.matches);
  }

  onClose() {
    this.contentEl.empty();
  }
}
