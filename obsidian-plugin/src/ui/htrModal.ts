// HTR Modal: muestra el progreso del reconocimiento y el resultado con opciones.

import { App, Modal } from "obsidian";
import { HTRManager } from "../htr/manager";
import { PressureStroke, HTRResult } from "../types";

export class HTRModal extends Modal {
  private result: HTRResult | null = null;
  private progressEl: HTMLElement | null = null;

  constructor(
    app: App,
    private manager: HTRManager,
    private strokes: PressureStroke[],
    private language: string,
    private onResult: (r: HTRResult) => void
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "500px";
    contentEl.createEl("h2", { text: "✍️ Reconocimiento de escritura" });

    const info = contentEl.createEl("p", { cls: "mnexus-label" });
    info.textContent = `${this.strokes.length} trazos, idioma: ${this.language}`;

    this.progressEl = contentEl.createDiv({ cls: "mnexus-htr-progress" });
    this.progressEl.innerHTML = `<p>Enviando trazos al backend…</p>`;

    // Hacer el reconocimiento async
    try {
      this.result = await this.manager.getProvider().recognize(this.strokes, { language: this.language });
      this.renderResult();
    } catch (e) {
      this.progressEl.empty();
      this.progressEl.createEl("p", { text: "Error: " + (e as Error).message, cls: "mnexus-coverage-alert" });
      const close = contentEl.createEl("button", { text: "Cerrar" });
      close.onclick = () => this.close();
    }
  }

  private renderResult() {
    if (!this.result || !this.progressEl) return;
    this.progressEl.empty();
    const r = this.result;
    this.progressEl.createEl("p", {
      text: `✔ Reconocido en ${r.durationMs}ms (confianza ${(r.confidence * 100).toFixed(0)}%)`,
      cls: "mnexus-label",
    });
    const ta = this.progressEl.createEl("textarea") as HTMLTextAreaElement;
    ta.value = r.text;
    ta.rows = Math.min(10, Math.max(3, r.lines.length + 1));
    ta.style.cssText = "width:100%;margin:8px 0;padding:8px;font-family:var(--font-monospace);border-radius:4px;border:1px solid var(--background-modifier-border);";

    const row = this.progressEl.createDiv();
    row.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    const accept = row.createEl("button", { text: "✅ Usar este texto" });
    accept.style.cssText = "flex:1;background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:6px;border-radius:4px;cursor:pointer;";
    const cancel = row.createEl("button", { text: "Cancelar" });
    accept.onclick = () => {
      this.result = { ...r, text: ta.value }; // permitir edición
      this.onResult(this.result);
      this.close();
    };
    cancel.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
