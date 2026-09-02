// Editor de templates de flashcards.
// Permite crear, editar, clonar y borrar templates. Los custom se persisten
// como .json en settings.templatesFolder.

import { App, Modal, Setting } from "obsidian";
import { FlashcardTemplate, CardType } from "../types";
import { TemplateManager } from "../flashcards/templates";

export class TemplateEditorModal extends Modal {
  private template: FlashcardTemplate;
  private isNew: boolean;

  constructor(
    app: App,
    private manager: TemplateManager,
    template?: FlashcardTemplate
  ) {
    super(app);
    this.isNew = !template;
    this.template = template
      ? JSON.parse(JSON.stringify(template))
      : this.emptyTemplate();
  }

  private emptyTemplate(): FlashcardTemplate {
    return {
      id: `custom-${Date.now()}`,
      name: "Nuevo template",
      subject: "general",
      description: "",
      cardType: "basic",
      systemPrompt: "Eres un profesor de medicina que crea flashcards de alta calidad.",
      userPrompt: "Nota: {{noteTitle}}\nMateria: {{subject}}\n\nContenido:\n{{noteContent}}\n\nGenera flashcards.",
      parserStrategy: "json",
      parserConfig: { jsonExample: '[{"front":"...","back":"...","tags":["..."]}]' },
      localFallback: "definitions",
      autoTags: [],
      examples: [],
      builtin: false,
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "600px";
    contentEl.createEl("h2", { text: this.isNew ? "Nuevo template" : `Editando: ${this.template.name}` });

    new Setting(contentEl).setName("ID (único)").addText((t) => {
      t.setValue(this.template.id).onChange((v) => (this.template.id = v.trim()));
      if (!this.isNew) t.setDisabled(true); // no se puede cambiar el id al editar
    });
    new Setting(contentEl).setName("Nombre").addText((t) => {
      t.setValue(this.template.name).onChange((v) => (this.template.name = v));
    });
    new Setting(contentEl).setName("Materia (subject)").addText((t) => {
      t.setValue(this.template.subject).onChange((v) => (this.template.subject = v.toLowerCase().trim()));
    });
    new Setting(contentEl).setName("Descripción").addText((t) => {
      t.setValue(this.template.description).onChange((v) => (this.template.description = v));
    });
    new Setting(contentEl).setName("Tipo de tarjeta").addDropdown((d) => {
      const types: CardType[] = ["basic", "cloze", "reversed", "list", "image-occlusion", "freeform"];
      for (const t of types) d.addOption(t, t);
      d.setValue(this.template.cardType);
      d.onChange((v) => (this.template.cardType = v as CardType));
    });
    new Setting(contentEl).setName("Estrategia de parser").addDropdown((d) => {
      d.addOption("json", "JSON (recomendado)");
      d.addOption("markdown", "Markdown (Pregunta/Respuesta)");
      d.addOption("regex", "Regex custom");
      d.setValue(this.template.parserStrategy);
      d.onChange((v) => (this.template.parserStrategy = v as FlashcardTemplate["parserStrategy"]));
    });
    new Setting(contentEl).setName("Fallback local").addDropdown((d) => {
      d.addOption("definitions", "Definiciones (Término: definición)");
      d.addOption("lists", "Listas numeradas");
      d.addOption("headings", "Secciones y sus cuerpos");
      d.addOption("none", "Ninguno");
      d.setValue(this.template.localFallback);
      d.onChange((v) => (this.template.localFallback = v as FlashcardTemplate["localFallback"]));
    });
    new Setting(contentEl).setName("Tags automáticos (separados por coma)").addText((t) => {
      t.setValue(this.template.autoTags.join(", ")).onChange((v) =>
        (this.template.autoTags = v.split(",").map((s) => s.trim()).filter(Boolean))
      );
    });

    contentEl.createEl("h3", { text: "System Prompt" });
    const sysArea = contentEl.createEl("textarea");
    sysArea.value = this.template.systemPrompt;
    sysArea.rows = 6;
    sysArea.style.width = "100%";
    sysArea.oninput = () => (this.template.systemPrompt = sysArea.value);

    contentEl.createEl("h3", { text: "User Prompt (placeholders: {{noteTitle}}, {{noteContent}}, {{subject}})" });
    const userArea = contentEl.createEl("textarea");
    userArea.value = this.template.userPrompt;
    userArea.rows = 6;
    userArea.style.width = "100%";
    userArea.oninput = () => (this.template.userPrompt = userArea.value);

    contentEl.createEl("h3", { text: "Configuración del parser (JSON)" });
    const jsonArea = contentEl.createEl("textarea");
    jsonArea.value = this.template.parserConfig?.jsonExample ?? "";
    jsonArea.rows = 3;
    jsonArea.style.width = "100%";
    jsonArea.oninput = () => {
      this.template.parserConfig = { ...this.template.parserConfig, jsonExample: jsonArea.value };
    };

    // Acciones
    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.marginTop = "12px";
    const save = actions.createEl("button", { text: "💾 Guardar" });
    save.style.background = "var(--interactive-accent)";
    save.style.color = "var(--text-on-accent)";
    save.onclick = async () => {
      try {
        await this.manager.save(this.template);
        this.close();
      } catch (e) {
        alert("Error al guardar: " + (e as Error).message);
      }
    };
    const cancel = actions.createEl("button", { text: "Cancelar" });
    cancel.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Modal que lista todos los templates (built-in + custom) y permite gestionar. */
export class TemplateListModal extends Modal {
  constructor(
    app: App,
    private manager: TemplateManager,
    private onPick?: (id: string) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "600px";
    contentEl.createEl("h2", { text: "Templates de flashcards" });

    const newBtn = contentEl.createEl("button", { text: "➕ Nuevo template custom" });
    newBtn.style.marginBottom = "12px";
    newBtn.onclick = () => {
      new TemplateEditorModal(this.app, this.manager).open();
    };

    const all = this.manager.all();
    for (const t of all) {
      const card = contentEl.createDiv({ cls: "mnexus-template-card" });
      card.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:6px;padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px;";

      const info = card.createDiv();
      info.style.flex = "1";
      info.createEl("strong", { text: t.name });
      const meta = info.createDiv({ cls: "mnexus-label" });
      meta.createEl("span", { text: `${t.subject} · ${t.cardType} · ${t.builtin ? "built-in" : "custom"}` });

      if (!t.builtin) {
        const editBtn = card.createEl("button", { text: "✎" });
        editBtn.onclick = () => new TemplateEditorModal(this.app, this.manager, t).open();
        const delBtn = card.createEl("button", { text: "🗑" });
        delBtn.onclick = async () => {
          if (confirm(`¿Borrar template '${t.name}'?`)) {
            await this.manager.delete(t.id);
            this.onOpen();
          }
        };
      }
      if (this.onPick) {
        const pick = card.createEl("button", { text: "Usar" });
        const cb = this.onPick;
        pick.onclick = () => {
          cb(t.id);
          this.close();
        };
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
