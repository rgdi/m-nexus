// OnboardingWizard: tour guiado en el primer arranque.
// Cubre los 6 setups principales: Whisper, LLM, RAG, Calendar, Sync, Drawing.
// El usuario puede saltarlo o completarlo paso a paso.

import { App, Modal } from "obsidian";
import { MNexusSettings } from "../types";

export interface OnboardingContext {
  app: App;
  settings: MNexusSettings;
  saveSettings: () => Promise<void>;
  /** Acciones que el wizard puede disparar. */
  actions: {
    installWhisper: () => void;
    openLLMSettings: () => void;
    openRAGSettings: () => void;
    indexVault: () => void;
    openCalendarSettings: () => void;
    openSyncSettings: () => void;
    openDrawing: () => void;
    authorizeGoogle: () => void;
  };
}

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  emoji: string;
  cta: string;
  /** Acción opcional al hacer click en CTA. */
  ctaAction?: () => void;
  /** Estado: "todo" | "ready" | "skipped" | "done". */
  status: (s: MNexusSettings, ctx: OnboardingContext) => "todo" | "ready" | "done";
  /** Si está completado según settings. */
  isDone: (s: MNexusSettings) => boolean;
}

const STEPS: OnboardingStep[] = [
  {
    id: "whisper",
    title: "Whisper para transcribir audio",
    description: "Instala Whisper localmente con un click. Privado, gratis, sin nube. Transcribe tus clases automáticamente.",
    emoji: "🎙️",
    cta: "Instalar Whisper",
    ctaAction: undefined, // se inyecta en runtime
    isDone: () => false, // se chequea con checkWhisperInstalled
    status: () => "ready",
  },
  {
    id: "llm",
    title: "Conecta un LLM (OpenRouter)",
    description: "OpenRouter te da acceso a Claude, GPT, Gemini, Llama y más con una sola API key. Necesario para generar flashcards y chatear con tus notas.",
    emoji: "🧠",
    cta: "Configurar LLM",
    isDone: (s) => Boolean(s.openrouterApiKey?.trim()),
    status: (s) => (s.openrouterApiKey ? "done" : "ready"),
  },
  {
    id: "rag",
    title: "Indexa tus notas para RAG",
    description: "El RAG permite buscar semánticamente en tus notas y chatear con ellas. Una sola indexación basta; se reusa la API key del LLM.",
    emoji: "🔍",
    cta: "Indexar vault",
    isDone: () => false,
    status: () => "ready",
  },
  {
    id: "calendar",
    title: "Sincroniza tu calendario académico",
    description: "Conecta Google Calendar o pega un ICS de tu universidad. Los exámenes se asignan automáticamente a las notas.",
    emoji: "📅",
    cta: "Configurar calendar",
    isDone: (s) => s.enableCalendarSync || s.enableGoogleCalendar,
    status: (s) => (s.enableCalendarSync || s.enableGoogleCalendar ? "done" : "ready"),
  },
  {
    id: "sync",
    title: "Sync entre dispositivos (WebDAV)",
    description: "Usa Nextcloud, ownCloud o cualquier WebDAV para tener tus notas en todos tus dispositivos. Escribe en tu Mac, repasa en tu iPad.",
    emoji: "🔄",
    cta: "Configurar sync",
    isDone: (s) => s.syncBackend === "webdav" && Boolean(s.webdavUrl),
    status: (s) => (s.syncBackend === "webdav" && s.webdavUrl ? "done" : "ready"),
  },
  {
    id: "drawing",
    title: "Pruébalo: dibuja con tu lápiz",
    description: "Abre el pane de dibujo. Soporta Apple Pencil, S Pen y mouse, con presión variable y palm rejection.",
    emoji: "✏️",
    cta: "Abrir dibujo",
    isDone: () => false,
    status: () => "ready",
  },
];

export class OnboardingWizard extends Modal {
  private currentStep = 0;
  private skipAll = false;

  constructor(private ctx: OnboardingContext) {
    super(ctx.app);
  }

  onOpen() {
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "600px";
    contentEl.style.maxWidth = "700px";

    // Header con progreso
    const header = contentEl.createDiv({ cls: "mnexus-onboard-header" });
    const total = STEPS.length;
    const done = STEPS.filter((s) => s.isDone(this.ctx.settings)).length;
    header.createEl("h2", { text: "👋 ¡Bienvenido a M-NEXUS!" });
    const sub = header.createEl("p", { cls: "mnexus-label" });
    sub.textContent = `Setup en ${total} pasos opcionales · ${done}/${total} completados`;

    const progress = contentEl.createDiv({ cls: "mnexus-progress" });
    progress.style.cssText = "height:6px;background:var(--background-modifier-border);border-radius:3px;overflow:hidden;margin:8px 0;";
    const bar = progress.createDiv();
    bar.style.cssText = `height:100%;background:var(--interactive-accent);width:${(done / total) * 100}%;transition:width 0.3s;`;

    // Step actual
    const step = STEPS[this.currentStep];
    const card = contentEl.createDiv({ cls: "mnexus-onboard-step" });
    card.style.cssText = "padding:16px;background:var(--background-secondary);border-radius:8px;margin:12px 0;";

    const stepHeader = card.createDiv();
    stepHeader.style.cssText = "display:flex;align-items:center;gap:12px;margin-bottom:8px;";
    stepHeader.createEl("div", { text: step.emoji, cls: "mnexus-onboard-emoji" });
    stepHeader.createEl("strong", { text: step.title });
    const statusBadge = stepHeader.createEl("span", { cls: "mnexus-badge " + (step.isDone(this.ctx.settings) ? "approved" : "draft") });
    statusBadge.textContent = step.isDone(this.ctx.settings) ? "✓ Listo" : "Pendiente";
    statusBadge.style.marginLeft = "auto";

    card.createEl("p", { text: step.description, cls: "mnexus-onboard-desc" });

    // Acciones
    const actions = card.createDiv({ cls: "mnexus-onboard-actions" });
    actions.style.cssText = "display:flex;gap:6px;margin-top:12px;";
    const cta = actions.createEl("button", { text: step.cta });
    cta.style.cssText = "background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:6px 12px;border-radius:4px;cursor:pointer;";
    cta.onclick = () => {
      const actionMap: Record<string, (() => void) | undefined> = {
        whisper: () => this.ctx.actions.installWhisper(),
        llm: () => this.ctx.actions.openLLMSettings(),
        rag: () => { this.ctx.actions.openRAGSettings(); this.ctx.actions.indexVault(); },
        calendar: () => this.ctx.actions.openCalendarSettings(),
        sync: () => this.ctx.actions.openSyncSettings(),
        drawing: () => { this.ctx.actions.openDrawing(); this.close(); },
      };
      const fn = actionMap[step.id];
      if (fn) fn();
    };
    const skip = actions.createEl("button", { text: "Saltar este paso" });
    skip.style.cssText = "background:transparent;border:1px solid var(--background-modifier-border);padding:6px 12px;border-radius:4px;cursor:pointer;";
    skip.onclick = () => this.next();

    // Navegación inferior
    const nav = contentEl.createDiv();
    nav.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-top:12px;";
    const prev = nav.createEl("button", { text: "← Anterior" });
    prev.disabled = this.currentStep === 0;
    prev.onclick = () => { this.currentStep--; this.render(); };
    const next = nav.createEl("button", { text: this.currentStep === STEPS.length - 1 ? "Finalizar" : "Siguiente →" });
    next.onclick = () => this.next();
    const skipAll = nav.createEl("button", { text: "Saltar todo" });
    skipAll.style.cssText = "background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:0.85em;";
    skipAll.onclick = () => this.skip();

    // Lista de pasos (resumen)
    const summary = contentEl.createDiv();
    summary.style.cssText = "margin-top:16px;border-top:1px solid var(--background-modifier-border);padding-top:12px;";
    summary.createEl("strong", { text: "Pasos" });
    const list = summary.createEl("ol");
    list.style.cssText = "margin:8px 0;padding-left:20px;font-size:0.85em;";
    STEPS.forEach((s, i) => {
      const li = list.createEl("li", {
        text: `${s.emoji} ${s.title}`,
        cls: i === this.currentStep ? "mnexus-onboard-current" : "",
      });
      li.style.cssText = `cursor:pointer;color:${i === this.currentStep ? "var(--text-accent)" : "var(--text-muted)"};padding:2px 0;`;
      if (s.isDone(this.ctx.settings)) li.style.textDecoration = "line-through";
      li.onclick = () => { this.currentStep = i; this.render(); };
    });
  }

  private next() {
    if (this.currentStep < STEPS.length - 1) {
      this.currentStep++;
      this.render();
    } else {
      this.close();
    }
  }

  private skip() {
    this.skipAll = true;
    this.close();
  }

  async onClose() {
    this.contentEl.empty();
    if (!this.ctx.settings.hasSeenOnboarding) {
      this.ctx.settings.hasSeenOnboarding = true;
      await this.ctx.saveSettings();
    }
  }
}
