// Panel de repaso activo: muestra tarjetas aprobadas cuyo dueDate <= hoy.
// Permite calificar Again/Hard/Good/Easy y aplica el FSRS en vivo.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { FlashcardDraft, Rating } from "../types";
import { PluginLike } from "../plugin-api";
import { PLUGIN_NAME, VIEW_TYPE_DASHBOARD } from "../constants";

export class ReviewPanelView extends ItemView {
  private queue: FlashcardDraft[] = [];
  private revealed = false;
  private current: FlashcardDraft | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PluginLike) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DASHBOARD; // reutiliza el panel lateral
  }
  getDisplayText(): string { return `${PLUGIN_NAME} — Repaso`; }
  getIcon(): string { return "repeat"; }

  async onOpen() {
    this.queue = await this.plugin.getDueCards();
    this.pickNext();
    this.render();
  }

  async onClose() {
    this.containerEl.children[1].empty();
  }

  private pickNext() {
    this.current = this.queue.shift() ?? null;
    this.revealed = false;
  }

  private render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mnexus-panel");

    const h = root.createEl("h2", { text: "Repaso activo" });
    h.createEl("small", { text: ` · ${this.queue.length + (this.current ? 1 : 0)} restantes`, cls: "mnexus-label" });

    if (!this.current) {
      root.createEl("div", { cls: "mnexus-empty", text: "🎉 No tienes repasos pendientes para hoy." });
      return;
    }

    const card = this.current;
    const cardEl = root.createDiv({ cls: "mnexus-flashcard" });
    const front = cardEl.createDiv({ cls: "front" });
    front.textContent = card.front;

    if (this.revealed) {
      const back = cardEl.createDiv({ cls: "back" });
      back.style.marginTop = "10px";
      back.textContent = card.back;

      if (card.fsrs) {
        const meta = cardEl.createDiv({ cls: "meta" });
        meta.createEl("span", { text: `S=${card.fsrs.stability}  D=${card.fsrs.difficulty}  reps=${card.fsrs.reps}` });
      }

      const actions = cardEl.createDiv({ cls: "actions" });
      const labels: [Rating, string][] = [
        [1, "Again"],
        [2, "Hard"],
        [3, "Good"],
        [4, "Easy"],
      ];
      for (const [rating, label] of labels) {
        const b = actions.createEl("button", { text: label });
        b.onclick = async () => {
          const updated = await this.plugin.applyFsrsReview(card, rating);
          if (updated) this.queue.push(updated);
          this.pickNext();
          this.render();
        };
      }
    } else {
      const reveal = root.createEl("button", { text: "Mostrar reverso" });
      reveal.style.marginTop = "10px";
      reveal.onclick = () => {
        this.revealed = true;
        this.render();
      };
    }
  }
}
