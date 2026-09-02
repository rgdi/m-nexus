// ConflictModal: UI para resolver un conflicto de sync WebDAV.
// Opciones: Mantener local, Mantener remoto, Mantener ambos (crea archivo .conflict).

import { App, Modal } from "obsidian";

export interface ConflictData {
  path: string;
  localContent: string;
  remoteContent: string;
  localMtime: number;
  remoteMtime: number;
  localSize: number;
  remoteSize: number;
}

export type ConflictResolution = "keep-local" | "keep-remote" | "keep-both";

export class ConflictModal extends Modal {
  private resolution: ConflictResolution | null = null;

  constructor(app: App, private conflict: ConflictData, private onResolve: (r: ConflictResolution) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "700px";
    contentEl.style.maxWidth = "90vw";

    const c = this.conflict;
    contentEl.createEl("h2", { text: "⚠️ Conflicto de sincronización" });
    contentEl.createEl("p", { cls: "mnexus-label", text: `Archivo: ${c.path}` });

    const meta = contentEl.createDiv({ cls: "mnexus-conflict-meta" });
    meta.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0;padding:8px;background:var(--background-secondary);border-radius:6px;";
    const localMeta = meta.createDiv();
    localMeta.createEl("strong", { text: "🖥️ Local" });
    localMeta.createEl("div", { text: `mtime: ${new Date(c.localMtime).toLocaleString()}`, cls: "mnexus-label" });
    localMeta.createEl("div", { text: `size: ${c.localSize} bytes`, cls: "mnexus-label" });
    const remoteMeta = meta.createDiv();
    remoteMeta.createEl("strong", { text: "☁️ Remoto" });
    remoteMeta.createEl("div", { text: `mtime: ${new Date(c.remoteMtime).toLocaleString()}`, cls: "mnexus-label" });
    remoteMeta.createEl("div", { text: `size: ${c.remoteSize} bytes`, cls: "mnexus-label" });

    // Vista lado a lado
    const diff = contentEl.createDiv({ cls: "mnexus-conflict-diff" });
    diff.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0;";
    const localBox = diff.createDiv();
    localBox.createEl("strong", { text: "Tu versión" });
    const localPre = localBox.createEl("pre");
    localPre.style.cssText = "max-height:300px;overflow:auto;padding:8px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;white-space:pre-wrap;font-size:0.85em;";
    localPre.textContent = c.localContent;
    const remoteBox = diff.createDiv();
    remoteBox.createEl("strong", { text: "Versión remota" });
    const remotePre = remoteBox.createEl("pre");
    remotePre.style.cssText = "max-height:300px;overflow:auto;padding:8px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:6px;white-space:pre-wrap;font-size:0.85em;";
    remotePre.textContent = c.remoteContent;

    // Acciones
    const actions = contentEl.createDiv();
    actions.style.cssText = "display:flex;gap:8px;margin-top:12px;";
    const keepLocal = actions.createEl("button", { text: "🖥️ Mantener mi versión" });
    keepLocal.style.cssText = "flex:1;background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:8px;border-radius:4px;cursor:pointer;";
    const keepRemote = actions.createEl("button", { text: "☁️ Sobrescribir con remoto" });
    keepRemote.style.cssText = "flex:1;background:var(--background-modifier-border);border:none;padding:8px;border-radius:4px;cursor:pointer;";
    const keepBoth = actions.createEl("button", { text: "🔀 Guardar ambas (.conflict)" });
    keepBoth.style.cssText = "flex:1;background:var(--background-modifier-border);border:none;padding:8px;border-radius:4px;cursor:pointer;";
    const cancel = actions.createEl("button", { text: "Cancelar" });

    keepLocal.onclick = () => this.resolve("keep-local");
    keepRemote.onclick = () => this.resolve("keep-remote");
    keepBoth.onclick = () => this.resolve("keep-both");
    cancel.onclick = () => this.close();
  }

  private resolve(r: ConflictResolution) {
    this.resolution = r;
    this.close();
    this.onResolve(r);
  }

  onClose() {
    this.contentEl.empty();
  }
}
