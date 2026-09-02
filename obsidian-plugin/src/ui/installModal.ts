// Modal de instalación de Whisper: muestra el progreso en tiempo real.

import { App, Modal } from "obsidian";
import { InstallProgress, MNexusSettings } from "../types";
import { WhisperInstaller } from "../audio/whisperInstaller";

export class WhisperInstallModal extends Modal {
  private progressEl!: HTMLElement;
  private logEl!: HTMLElement;
  private abortController: AbortController | null = null;

  constructor(
    app: App,
    private settings: MNexusSettings,
    private installer: WhisperInstaller,
    private onComplete: (ok: boolean) => void
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "500px";
    contentEl.createEl("h2", { text: "Instalación de Whisper local" });

    const desc = contentEl.createEl("p");
    desc.innerHTML = `Esto instalará <code>faster-whisper</code> y descargará el modelo <strong>${this.settings.whisperModel}</strong> en tu equipo. La instalación se hace localmente (sin enviar datos a la nube). Puede tardar unos minutos.`;

    const pyCheck = contentEl.createDiv();
    this.progressEl = contentEl.createDiv({ cls: "mnexus-progress" });
    this.progressEl.style.height = "8px";
    this.progressEl.style.background = "var(--background-modifier-border)";
    this.progressEl.style.borderRadius = "4px";
    this.progressEl.style.overflow = "hidden";
    this.progressEl.style.margin = "8px 0";
    const bar = this.progressEl.createDiv();
    bar.style.cssText = "height:100%;background:var(--interactive-accent);width:0%;transition:width 0.3s;";
    bar.id = "mnexus-install-bar";

    this.logEl = contentEl.createEl("div", { cls: "mnexus-label" });
    this.logEl.style.cssText = "font-family:var(--font-monospace);font-size:0.8em;max-height:200px;overflow:auto;background:var(--background-secondary);padding:8px;border-radius:4px;margin:8px 0;";

    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "6px";
    const startBtn = actions.createEl("button", { text: "▶ Instalar" });
    startBtn.style.background = "var(--interactive-accent)";
    startBtn.style.color = "var(--text-on-accent)";
    const cancelBtn = actions.createEl("button", { text: "Cancelar" });

    const log = (msg: string) => {
      this.logEl.createDiv({ text: msg });
      this.logEl.scrollTop = this.logEl.scrollHeight;
    };

    const updateProgress = (p: InstallProgress) => {
      const bar = this.progressEl.querySelector("#mnexus-install-bar") as HTMLElement;
      if (bar) bar.style.width = `${Math.round(p.progress * 100)}%`;
      log(`[${p.step}] ${p.message}${p.error ? " — " + p.error : ""}`);
    };

    startBtn.onclick = async () => {
      startBtn.disabled = true;
      cancelBtn.disabled = true;
      log("Comprobando Python…");
      const py = await this.installer.checkPython();
      if (!py.available) {
        log("✖ Python no encontrado: " + (py.error ?? ""));
        log("Instala Python 3.9+ o configura la ruta en Ajustes → M-NEXUS → Whisper Python path.");
        this.onComplete(false);
        return;
      }
      log(`✔ Python ${py.version}`);
      const result = await this.installer.installAll(this.settings.whisperModel, updateProgress);
      this.onComplete(result.ok);
    };

    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    this.abortController?.abort();
    this.contentEl.empty();
  }
}
