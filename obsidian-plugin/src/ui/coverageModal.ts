// Modal de cobertura: muestra huecos detectados y permite decidir uno a uno.

import { App, Modal } from "obsidian";
import { CoverageGap } from "../types";
import { PluginLike } from "../plugin-api";

export class CoverageModal extends Modal {
  constructor(app: App, private noteTitle: string, private gaps: CoverageGap[], private plugin: PluginLike) {
    super(app);
  }

  onOpen() {
    const root = this.contentEl;
    root.createEl("h2", { text: `Auditoría de cobertura: ${this.noteTitle}` });

    if (this.gaps.length === 0) {
      root.createEl("p", { text: "✅ No se detectaron huecos significativos. Tu nota cubre el temario." });
      const close = root.createEl("button", { text: "Cerrar" });
      close.onclick = () => this.close();
      return;
    }

    const summary = root.createEl("p");
    const crit = this.gaps.filter((g) => g.severity === "critical").length;
    summary.innerHTML = `<strong>${this.gaps.length} huecos</strong> detectados (${crit} críticos). Decide si añadirlos a tu nota.`;

    for (const gap of this.gaps) {
      const el = root.createDiv({ cls: "mnexus-coverage-alert" });
      const head = el.createDiv();
      head.createEl("strong", { text: gap.severity === "critical" ? "🔴 " : "🟡 " });
      head.createEl("span", { text: gap.topic });
      el.createEl("p", { text: gap.evidence, cls: "mnexus-label" });
      const actions = el.createDiv();
      actions.style.display = "flex";
      actions.style.gap = "6px";
      const add = actions.createEl("button", { text: "➕ Añadir a nota" });
      add.onclick = async () => {
        await this.plugin.appendGapToNote(gap);
        gap.resolved = true;
        el.style.opacity = "0.4";
      };
      const dismiss = actions.createEl("button", { text: "Descartar" });
      dismiss.onclick = () => {
        gap.resolved = true;
        el.style.opacity = "0.4";
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
