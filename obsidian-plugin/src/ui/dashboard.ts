// Panel lateral (sidebar) principal: dashboard M-NEXUS v2.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_DASHBOARD, PLUGIN_NAME } from "../constants";
import { PluginLike } from "../plugin-api";
import { renderStatusBar } from "./statusBar";

export class DashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: PluginLike) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_DASHBOARD; }
  getDisplayText(): string { return `${PLUGIN_NAME} — Panel`; }
  getIcon(): string { return "activity"; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mnexus-panel");
    await this.render(root);
  }

  async onClose() { this.containerEl.children[1].empty(); }

  async refresh() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    await this.render(root);
  }

  private async render(root: HTMLElement) {
    const data = await this.plugin.getDashboardData();

    // Header
    const h = root.createEl("h2", { text: "M-NEXUS" });
    h.createEl("small", { text: " · Control humano obligatorio", cls: "mnexus-label" });

    // Subsistemas: estado rápido
    const subs = root.createDiv({ cls: "mnexus-stat-grid" });
    this.subsystemCard(subs, "🧠 LLM", data.llmStatus.configured ? "✔ " + (data.llmStatus.model ?? "OK") : "✖ no config", data.llmStatus.configured ? "" : "alert");
    this.subsystemCard(subs, "🎙️ Whisper", data.whisperInstalled ? "✔ listo" : "✖ instalar", data.whisperInstalled ? "" : "warn");
    this.subsystemCard(subs, "📅 Calendar", data.calendarEnabled ? "✔ activo" : "off", data.calendarEnabled ? "" : "");
    this.subsystemCard(subs, "⏰ Socrático", "on", "");

    // Stats de estudio
    const grid = root.createDiv({ cls: "mnexus-stat-grid" });
    this.stat(grid, "Repasos hoy", String(data.dueToday), data.dueToday > 80 ? "warn" : "");
    this.stat(grid, "Pendientes aprobación", String(data.pendingApprovals), data.pendingApprovals > 0 ? "alert" : "");
    this.stat(grid, "En Inbox (audio)", String(data.inboxAudio), data.inboxAudio > 0 ? "warn" : "");
    this.stat(grid, "Huecos cobertura", String(data.criticalGaps), data.criticalGaps > 0 ? "alert" : "");

    // Próximos exámenes
    if (data.upcomingExams.length > 0) {
      const sec = root.createEl("div");
      sec.createEl("h3", { text: "Próximos exámenes" });
      const ul = sec.createEl("ul");
      for (const e of data.upcomingExams) {
        const li = ul.createEl("li");
        li.createEl("span", { text: e.subject + " — " });
        const strong = li.createEl("strong", { text: e.date });
        const days = Math.round((new Date(e.date).getTime() - Date.now()) / 86400000);
        li.createEl("span", { text: ` (${days} días)`, cls: "mnexus-label" });
        strong.addClass(`mnexus-priority-${e.priority}`);
      }
    }

    // Acciones
    const actions = root.createEl("div");
    actions.style.marginTop = "12px";
    actions.style.display = "grid";
    actions.style.gap = "6px";

    this.actionButton(actions, "📝 Procesar audio", "mnexus-process-audio");
    this.actionButton(actions, "🃏 Generar flashcards", "mnexus-generate-cards");
    this.actionButton(actions, "✅ Aprobar pendientes", "mnexus-open-approvals");
    this.actionButton(actions, "📚 Iniciar repaso", "mnexus-open-review");
    this.actionButton(actions, "🔍 Auditar cobertura", "mnexus-audit-coverage");
    this.actionButton(actions, "📋 Gestionar templates", "mnexus-open-templates");
    this.actionButton(actions, "🖋️ Procesar manuscrito", "mnexus-process-handwritten");
    this.actionButton(actions, "📅 Calendario de exámenes", "mnexus-calendar-preview");
    this.actionButton(actions, "✏️ Dibujar en nota", "mnexus-open-drawing");

    // Socrático
    if (data.socraticPrompt) {
      const soc = root.createEl("div", { cls: "mnexus-coverage-alert" });
      soc.createEl("strong", { text: "🧠 Pregunta socrática: " });
      soc.createEl("span", { text: data.socraticPrompt });
    }

    // Status bar
    renderStatusBar(root, data);

    // Onboarding hint si no se ha visto
    if (!this.plugin.listTemplates || false) {
      // (mostrar solo si no tiene templates custom ni config básica)
    }
  }

  private stat(parent: HTMLElement, label: string, value: string, mod: string) {
    const card = parent.createDiv({ cls: "mnexus-stat-card " + mod });
    card.createDiv({ cls: "stat-label", text: label });
    card.createDiv({ cls: "stat-value", text: value });
  }

  private subsystemCard(parent: HTMLElement, label: string, value: string, mod: string) {
    const card = parent.createDiv({ cls: "mnexus-stat-card " + mod });
    card.style.padding = "4px 8px";
    card.createDiv({ cls: "stat-label", text: label });
    const v = card.createDiv({ cls: "stat-value", text: value });
    v.style.fontSize = "0.95em";
  }

  private actionButton(parent: HTMLElement, label: string, cmdId: string) {
    const b = parent.createEl("button", { text: label });
    b.style.width = "100%";
    b.style.textAlign = "left";
    b.onclick = () =>
      (this.app as unknown as { commands: { executeCommandById: (id: string) => void } }).commands.executeCommandById(cmdId);
  }
}
