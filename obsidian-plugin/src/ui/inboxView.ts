// Vista del Inbox / "En Espera" — muestra audios huérfanos y manuscritos pendientes.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_INBOX, PLUGIN_NAME } from "../constants";
import { PluginLike } from "../plugin-api";

export class InboxView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: PluginLike) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_INBOX; }
  getDisplayText(): string { return `${PLUGIN_NAME} — En Espera`; }
  getIcon(): string { return "inbox"; }

  async onOpen() { await this.render(); }
  async onClose() { this.containerEl.children[1].empty(); }
  async refresh() { await this.render(); }

  private async render() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mnexus-panel");

    root.createEl("h2", { text: "En Espera" });
    root.createEl("small", {
      text: "Audios y manuscritos sin nota destino asignada. Vincula manualmente para que entren al flujo.",
      cls: "mnexus-label",
    });

    const audio = this.plugin.getInboxAudio();
    if (audio.length === 0) {
      root.createEl("div", { cls: "mnexus-empty", text: "Sin audios pendientes." });
    } else {
      root.createEl("h3", { text: "Audios" });
      for (const a of audio) {
        const item = root.createDiv({ cls: "mnexus-inbox-item" });
        const left = item.createDiv();
        left.createEl("strong", { text: a.fileName });
        const meta = left.createEl("div", { text: new Date(a.createdAt).toLocaleString(), cls: "mnexus-label" });
        if (a.targetNotePath) {
          meta.createEl("div", { text: `Sospecha: ${a.targetNotePath}`, cls: "mnexus-label" });
        }
        const link = item.createEl("button", { text: "Vincular a nota…" });
        link.onclick = async () => {
          const note = await this.plugin.promptForNote();
          if (!note) return;
          await this.plugin.linkAudioToNote(a.id, note);
          await this.render();
        };
      }
    }

    // Las transcripciones en Inbox se muestran como archivos .md
    const inboxes = await this.plugin.listInboxTranscripts();
    if (inboxes.length > 0) {
      root.createEl("h3", { text: "Transcripciones pendientes" });
      for (const t of inboxes) {
        const item = root.createDiv({ cls: "mnexus-inbox-item" });
        item.createEl("span", { text: t.basename, cls: "filename" });
        const open = item.createEl("button", { text: "Abrir" });
        open.onclick = () => this.app.workspace.openLinkText(t.path, "", false);
      }
    }
  }
}
