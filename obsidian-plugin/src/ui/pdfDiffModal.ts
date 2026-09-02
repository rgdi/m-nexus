// PdfDiffModal: muestra el diff entre dos versiones de un PDF.

import { App, Modal, TFile } from "obsidian";
import { PdfDiff, PdfVersion, PdfDiffResult } from "../pdf/diff";
import { PdfManager } from "../pdf/manager";
import { Logger } from "../utils/logger";

const KIND_COLORS = {
  equal: "var(--text-muted)",
  modified: "var(--text-warning)",
  added: "var(--text-success)",
  removed: "var(--text-error)",
};

const KIND_ICONS = {
  equal: "·",
  modified: "✎",
  added: "+",
  removed: "−",
};

export class PdfDiffModal extends Modal {
  constructor(
    app: App,
    private file: TFile,
    private manager: PdfManager,
    private log: Logger
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "700px";
    contentEl.createEl("h2", { text: `🔄 Diff PDF: ${this.file.basename}` });

    try {
      const pair = await this.manager.detectAndPair(this.file);
      if (!pair) {
        contentEl.createEl("p", {
          text: "No hay versión anterior registrada para este PDF. La versión actual se ha guardado.",
          cls: "mnexus-label",
        });
        return;
      }
      const diff = new PdfDiff();
      const result = diff.compare(pair.previous, pair.current);
      this.renderDiff(result);
    } catch (e) {
      contentEl.createEl("p", { text: "Error: " + (e as Error).message, cls: "mnexus-label" });
    }
  }

  private renderDiff(result: PdfDiffResult) {
    const { contentEl } = this;
    const summary = contentEl.createDiv();
    summary.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;margin:8px 0;padding:8px;background:var(--background-secondary);border-radius:6px;";
    const items = [
      { label: "Cambio total", value: `${Math.round(result.summary.changeRatio * 100)}%` },
      { label: "Iguales", value: result.summary.equal },
      { label: "Modificados", value: result.summary.modified, color: KIND_COLORS.modified },
      { label: "Añadidos", value: result.summary.added, color: KIND_COLORS.added },
      { label: "Eliminados", value: result.summary.removed, color: KIND_COLORS.removed },
    ];
    for (const i of items) {
      const card = summary.createDiv();
      card.createEl("div", { text: i.label, cls: "mnexus-label" });
      const v = card.createEl("strong", { text: String(i.value) });
      if (i.color) v.style.color = i.color;
    }
    contentEl.createEl("p", {
      text: `Versión A: ${result.versionA.uploadedAt.slice(0, 19)} (${Math.round(result.versionA.size / 1024)} KB) → Versión B: ${result.versionB.uploadedAt.slice(0, 19)} (${Math.round(result.versionB.size / 1024)} KB)`,
      cls: "mnexus-label",
    });
    const list = contentEl.createDiv();
    list.style.cssText = "max-height:500px;overflow-y:auto;border:1px solid var(--background-modifier-border);border-radius:6px;";
    let shown = 0;
    for (const hunk of result.hunks) {
      if (hunk.kind === "equal" && hunk.oldText === hunk.newText) continue;
      const row = list.createDiv();
      row.style.cssText = `padding:6px 8px;border-bottom:1px solid var(--background-modifier-hover);display:flex;align-items:flex-start;gap:8px;`;
      const icon = row.createEl("span", { text: KIND_ICONS[hunk.kind] });
      icon.style.cssText = `color:${KIND_COLORS[hunk.kind]};font-weight:bold;flex-shrink:0;width:16px;`;
      const body = row.createDiv();
      body.style.cssText = "flex:1;font-size:var(--font-ui-small);";
      if (hunk.kind === "modified" && hunk.oldText && hunk.newText) {
        body.createEl("div", { text: "Antes: " + hunk.oldText });
        body.createEl("div", { text: "Ahora: " + hunk.newText });
        body.createEl("small", { text: `Similitud: ${Math.round(hunk.similarity * 100)}%`, cls: "mnexus-label" });
      } else if (hunk.kind === "added" && hunk.newText) {
        body.createEl("div", { text: hunk.newText });
      } else if (hunk.kind === "removed" && hunk.oldText) {
        const div = body.createEl("div", { text: hunk.oldText });
        div.style.textDecoration = "line-through";
      }
      shown++;
    }
    if (shown === 0) {
      list.createEl("p", { text: "Sin cambios detectables entre versiones (puede ser solo cambio de formato).", cls: "mnexus-label" });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
