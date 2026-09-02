// v0.21: ManualCreationModal — wizard unificado para crear notas/flashcards/exámenes
// desde la UI de manera atractiva y sin fricción.

import { Modal, Setting, App } from "obsidian";

export type CreationType = "note" | "flashcard" | "exam" | "schedule-class";

export interface ManualCreationResult {
  type: CreationType;
  data: Record<string, unknown>;
}

export class ManualCreationModal extends Modal {
  private onSubmit: (result: ManualCreationResult) => void | Promise<void>;
  private selectedType: CreationType = "note";

  constructor(
    app: App,
    onSubmit: (result: ManualCreationResult) => void | Promise<void>
  ) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = "min-width:600px;max-width:800px;";
    contentEl.addClass("mnexus-manual-creation");

    // Header
    const header = contentEl.createDiv({ cls: "mnexus-creation-header" });
    header.style.cssText = "text-align:center;margin-bottom:20px;";
    header.createEl("h1", { text: "✨ Crear manualmente" });
    header.createEl("p", {
      text: "Elige qué quieres crear. Sin fricción, sin wizards de 10 pasos.",
      cls: "setting-item-description",
    });

    // Tiles de selección
    const tilesContainer = contentEl.createDiv({ cls: "mnexus-creation-tiles" });
    tilesContainer.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;margin-bottom:20px;";

    this.createTile(tilesContainer, "📝", "Nota de estudio", "Una nota markdown con frontmatter M-NEXUS", "note");
    this.createTile(tilesContainer, "🃏", "Flashcard", "Una tarjeta individual (front/back)", "flashcard");
    this.createTile(tilesContainer, "📅", "Examen", "Programa un examen con scope y fecha", "exam");
    this.createTile(tilesContainer, "⏰", "Clase del horario", "Añade una clase a tu horario semanal", "schedule-class");
  }

  private createTile(
    parent: HTMLElement,
    icon: string,
    title: string,
    desc: string,
    type: CreationType
  ) {
    const tile = parent.createDiv({ cls: "mnexus-creation-tile" });
    tile.style.cssText = `
      padding:16px;
      border:2px solid var(--background-modifier-border);
      border-radius:8px;
      cursor:pointer;
      transition:all 0.2s;
      text-align:center;
    `;
    tile.addEventListener("mouseover", () => {
      tile.style.borderColor = "var(--interactive-accent)";
      tile.style.transform = "translateY(-2px)";
    });
    tile.addEventListener("mouseout", () => {
      tile.style.borderColor = "var(--background-modifier-border)";
      tile.style.transform = "translateY(0)";
    });
    tile.addEventListener("click", () => {
      this.selectedType = type;
      this.renderForm();
    });
    tile.createDiv({ cls: "mnexus-tile-icon", text: icon }).style.cssText = "font-size:32px;margin-bottom:8px;";
    tile.createEl("h3", { text: title });
    tile.createEl("p", { text: desc, cls: "setting-item-description" });
  }

  private renderForm() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = "min-width:600px;max-width:800px;";

    // Volver
    const back = contentEl.createEl("button", { text: "← Volver" });
    back.style.cssText = "margin-bottom:16px;padding:6px 12px;border-radius:4px;background:var(--background-modifier-border);";
    back.onclick = () => this.onOpen();

    contentEl.createEl("h1", { text: this.getTitle() });

    if (this.selectedType === "note") {
      this.renderNoteForm(contentEl);
    } else if (this.selectedType === "flashcard") {
      this.renderFlashcardForm(contentEl);
    } else if (this.selectedType === "exam") {
      this.renderExamForm(contentEl);
    } else if (this.selectedType === "schedule-class") {
      this.renderScheduleClassForm(contentEl);
    }
  }

  private getTitle(): string {
    return {
      "note": "📝 Nueva nota",
      "flashcard": "🃏 Nueva flashcard",
      "exam": "📅 Nuevo examen",
      "schedule-class": "⏰ Nueva clase",
    }[this.selectedType];
  }

  private renderNoteForm(parent: HTMLElement) {
    const form = parent.createDiv({ cls: "mnexus-form" });
    form.style.cssText = "display:flex;flex-direction:column;gap:12px;";

    const titleInput = this.createInput(form, "Título de la nota", "Título descriptivo");
    const folderInput = this.createInput(form, "Carpeta destino", "inbox");
    const subjectInput = this.createInput(form, "Asignatura (subject)", "Anatomía");
    const topicInput = this.createInput(form, "Tema (topic)", "Aparato digestivo");
    const tagsInput = this.createInput(form, "Tags (separados por coma)", "m-nexus/auto, importante");
    const bodyArea = this.createTextarea(form, "Contenido inicial (opcional)", "Escribe aquí el contenido...");

    const submit = parent.createEl("button", { text: "✅ Crear nota" });
    submit.style.cssText = "margin-top:16px;padding:10px;background:var(--interactive-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;";
    submit.onclick = async () => {
      const title = (titleInput as HTMLInputElement).value.trim();
      if (!title) {
        this.showError(form, "El título es obligatorio");
        return;
      }
      await this.onSubmit({
        type: "note",
        data: {
          title,
          folder: (folderInput as HTMLInputElement).value.trim() || "inbox",
          subject: (subjectInput as HTMLInputElement).value.trim(),
          topic: (topicInput as HTMLInputElement).value.trim(),
          tags: (tagsInput as HTMLInputElement).value.split(",").map((t) => t.trim()).filter(Boolean),
          body: (bodyArea as HTMLTextAreaElement).value,
        },
      });
      this.close();
    };
  }

  private renderFlashcardForm(parent: HTMLElement) {
    const form = parent.createDiv({ cls: "mnexus-form" });
    form.style.cssText = "display:flex;flex-direction:column;gap:12px;";

    const frontInput = this.createTextarea(form, "Pregunta (front)", "¿Cuál es el hueso más largo del cuerpo humano?");
    const backInput = this.createTextarea(form, "Respuesta (back)", "El fémur.");
    const topicInput = this.createInput(form, "Tema (topic)", "Anatomía - Huesos");
    const noteInput = this.createInput(form, "Nota de origen (path)", "Anatomía/Tema-1.md");
    const tagsInput = this.createInput(form, "Tags (separados por coma)", "m-nexus/auto, anatomía");

    const submit = parent.createEl("button", { text: "✅ Crear flashcard" });
    submit.style.cssText = "margin-top:16px;padding:10px;background:var(--interactive-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;";
    submit.onclick = async () => {
      const front = (frontInput as HTMLTextAreaElement).value.trim();
      const back = (backInput as HTMLTextAreaElement).value.trim();
      if (!front || !back) {
        this.showError(form, "Front y Back son obligatorios");
        return;
      }
      await this.onSubmit({
        type: "flashcard",
        data: {
          front,
          back,
          topic: (topicInput as HTMLInputElement).value.trim(),
          notePath: (noteInput as HTMLInputElement).value.trim(),
          tags: (tagsInput as HTMLInputElement).value.split(",").map((t) => t.trim()).filter(Boolean),
        },
      });
      this.close();
    };
  }

  private renderExamForm(parent: HTMLElement) {
    const form = parent.createDiv({ cls: "mnexus-form" });
    form.style.cssText = "display:flex;flex-direction:column;gap:12px;";

    const titleInput = this.createInput(form, "Título del examen", "Parcial Bioquímica");
    const subjectInput = this.createInput(form, "Asignatura", "Bioquímica");
    const dateInput = this.createInput(form, "Fecha (YYYY-MM-DD)", dayOffset(7));
    (dateInput as HTMLInputElement).type = "date";
    const scopeInput = this.createInput(form, "Scope (carpeta o tag)", "Bioquímica");

    const submit = parent.createEl("button", { text: "✅ Crear examen" });
    submit.style.cssText = "margin-top:16px;padding:10px;background:var(--interactive-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;";
    submit.onclick = async () => {
      const title = (titleInput as HTMLInputElement).value.trim();
      const date = (dateInput as HTMLInputElement).value.trim();
      if (!title || !date) {
        this.showError(form, "Título y fecha son obligatorios");
        return;
      }
      await this.onSubmit({
        type: "exam",
        data: {
          title,
          subject: (subjectInput as HTMLInputElement).value.trim(),
          date,
          scope: (scopeInput as HTMLInputElement).value.trim(),
        },
      });
      this.close();
    };
  }

  private renderScheduleClassForm(parent: HTMLElement) {
    const form = parent.createDiv({ cls: "mnexus-form" });
    form.style.cssText = "display:flex;flex-direction:column;gap:12px;";

    const subjectInput = this.createInput(form, "Asignatura", "Anatomía II");
    const daySelect = parent.createEl("select");
    daySelect.style.cssText = "padding:8px;border-radius:4px;";
    ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"].forEach((d, i) => {
      const opt = daySelect.createEl("option", { text: d, value: String(i) });
    });
    this.createLabel(form, "Día de la semana");
    form.appendChild(daySelect);

    const startTimeInput = this.createInput(form, "Hora de inicio (HH:MM)", "09:00");
    (startTimeInput as HTMLInputElement).type = "time";
    const durationInput = this.createInput(form, "Duración (minutos)", "60");
    (durationInput as HTMLInputElement).type = "number";
    const locationInput = this.createInput(form, "Aula o ubicación (opcional)", "Aula 201");

    const submit = parent.createEl("button", { text: "✅ Añadir al horario" });
    submit.style.cssText = "margin-top:16px;padding:10px;background:var(--interactive-accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;";
    submit.onclick = async () => {
      const subject = (subjectInput as HTMLInputElement).value.trim();
      const startTime = (startTimeInput as HTMLInputElement).value;
      const duration = parseInt((durationInput as HTMLInputElement).value, 10);
      if (!subject || !startTime || isNaN(duration)) {
        this.showError(form, "Todos los campos son obligatorios");
        return;
      }
      const [hours, minutes] = startTime.split(":").map((n) => parseInt(n, 10));
      const startMinute = hours * 60 + minutes;
      await this.onSubmit({
        type: "schedule-class",
        data: {
          subject,
          dayOfWeek: parseInt(daySelect.value, 10),
          startMinute,
          durationMinutes: duration,
          location: (locationInput as HTMLInputElement).value.trim() || undefined,
        },
      });
      this.close();
    };
  }

  private createInput(parent: HTMLElement, label: string, placeholder: string): HTMLElement {
    this.createLabel(parent, label);
    const input = parent.createEl("input", { placeholder });
    input.style.cssText = "width:100%;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);";
    return input;
  }

  private createTextarea(parent: HTMLElement, label: string, placeholder: string): HTMLElement {
    this.createLabel(parent, label);
    const ta = parent.createEl("textarea", { placeholder });
    ta.style.cssText = "width:100%;min-height:80px;padding:8px;border-radius:4px;border:1px solid var(--background-modifier-border);font-family:inherit;";
    return ta;
  }

  private createLabel(parent: HTMLElement, text: string) {
    const label = parent.createEl("label", { text });
    label.style.cssText = "font-weight:600;margin-top:4px;display:block;";
    return label;
  }

  private showError(parent: HTMLElement, msg: string) {
    const existing = parent.querySelector(".mnexus-form-error");
    if (existing) existing.remove();
    const err = parent.createDiv({ cls: "mnexus-form-error" });
    err.style.cssText = "color:var(--text-error);padding:8px;background:var(--background-modifier-error);border-radius:4px;";
    err.textContent = `⚠️ ${msg}`;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
