// Modal de aprobación humana de flashcards (Human-in-the-Loop).
// El usuario ve cada borrador, puede editarlo, aprobarlo o rechazarlo.
// Sin aprobación, la tarjeta NUNCA entra al motor FSRS.

import { App, Modal } from "obsidian";
import { FlashcardDraft, ReviewItem } from "../types";
import { PluginLike } from "../plugin-api";

export class ApprovalModal extends Modal {
  private items: ReviewItem[];
  private index = 0;

  constructor(app: App, items: ReviewItem[], private plugin: PluginLike) {
    super(app);
    this.items = items.filter((i) => i.card.status === "draft");
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mnexus-approval-modal");

    if (this.index >= this.items.length) {
      contentEl.createEl("h2", { text: "¡Cola vacía!" });
      contentEl.createEl("p", { text: "No quedan borradores pendientes de aprobación." });
      const close = contentEl.createEl("button", { text: "Cerrar" });
      close.onclick = () => this.close();
      return;
    }

    const item = this.items[this.index];
    contentEl.createEl("small", {
      text: `Borrador ${this.index + 1} de ${this.items.length} — ${item.noteTitle ?? item.card.notePath}`,
    });

    // Anverso editable
    const frontLabel = contentEl.createEl("label", { text: "Anverso" });
    const frontArea = contentEl.createEl("textarea") as HTMLTextAreaElement;
    frontArea.value = item.card.front;
    frontArea.rows = 3;
    frontArea.style.width = "100%";

    // Reverso editable
    const backLabel = contentEl.createEl("label", { text: "Reverso" });
    backLabel.style.marginTop = "10px";
    backLabel.style.display = "block";
    const backArea = contentEl.createEl("textarea") as HTMLTextAreaElement;
    backArea.value = item.card.back;
    backArea.rows = 5;
    backArea.style.width = "100%";

    // Tags editables
    const tagsLabel = contentEl.createEl("label", { text: "Tags (separados por coma)" });
    tagsLabel.style.marginTop = "10px";
    tagsLabel.style.display = "block";
    const tagsInput = contentEl.createEl("input") as HTMLInputElement;
    tagsInput.type = "text";
    tagsInput.value = item.card.tags.join(", ");
    tagsInput.style.width = "100%";

    // Acciones
    const actions = contentEl.createDiv({ cls: "mnexus-flashcard" });
    actions.style.border = "none";
    actions.style.padding = "12px 0 0";
    const row = actions.createDiv();
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr 1fr 1fr";
    row.style.gap = "6px";

    const rejectBtn = row.createEl("button", { text: "🗑 Rechazar" });
    rejectBtn.onclick = async () => {
      await this.plugin.rejectCard(item.card.id);
      this.index++;
      this.render();
    };

    const skipBtn = row.createEl("button", { text: "⏭ Saltar" });
    skipBtn.onclick = () => {
      this.index++;
      this.render();
    };

    const approveBtn = row.createEl("button", { text: "✅ Aprobar" });
    approveBtn.style.background = "var(--interactive-accent)";
    approveBtn.style.color = "var(--text-on-accent)";
    approveBtn.onclick = async () => {
      // Deshabilitar todos los botones durante la operación async
      // para evitar doble click.
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      skipBtn.disabled = true;
      try {
        const updated: FlashcardDraft = {
          ...item.card,
          front: frontArea.value.trim() || item.card.front,
          back: backArea.value.trim() || item.card.back,
          tags: tagsInput.value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        };
        await this.plugin.approveCard(updated);
        this.index++;
        this.render();
      } catch (e) {
        // Si falla, re-habilitar para que el usuario pueda reintentar
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        skipBtn.disabled = false;
        throw e;
      }
    };
  }
}
