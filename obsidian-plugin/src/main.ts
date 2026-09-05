// M-NEXUS — plugin principal de Obsidian (v0.28 THIN CLIENT).
//
// Este archivo es INTENCIONALMENTE pequeño. Toda la lógica pesada se carga
// bajo demanda desde `./subsystems.ts` (lazy imports) o se ejecuta en el
// backend vía `./services/aiClient.ts`.
//
// El plugin solo hace:
//   1) Carga ajustes + datos persistentes
//   2) Registra comandos (lazy: cada comando carga su subsistema al invocarse)
//   3) Registra vistas
//   4) Delega la lógica AI al backend
//
// Bundle target: < 100KB

import { App, Plugin, WorkspaceLeaf } from "obsidian";
import type { MNexusSettings } from "./types";
import { DEFAULT_SETTINGS, VIEW_TYPE_CHAT, VIEW_TYPE_DASHBOARD, VIEW_TYPE_INBOX } from "./constants";
import { MNexusSettingTab } from "./settings";
import { Logger } from "./utils/logger";
import { device } from "./device/detector";
import { AudioRouter } from "./audio/router";
import { AudioRegistry } from "./audio/registry";
import { Transcriber } from "./audio/transcriber";
import { FrontmatterManager } from "./metadata/frontmatter";
import { getBackendConfig, backendEvalVault, backendNextQuestion, backendUpdateMastery, backendGenerateProposals } from "./services/aiClient";
import {
  loadWhisperInstaller, loadFlashcardGenerator, loadTemplateManager,
  loadCoverageAuditor, loadHandwrittenOcr, loadFSRS, loadLoadBalancer,
  loadLLMManager, loadCalendarSync, loadDrawingManager, loadRAG,
  loadSyncManager, loadHTRManager, loadStudyOrchestrator, loadVaultEvaluator,
  loadKnowledgeGraph, loadAdaptiveQuiz, loadExamScheduler,
} from "./subsystems";

export default class MNexusPlugin extends Plugin {
  app!: App;
  settings!: MNexusSettings;
  log!: Logger;
  // v0.28: acceso al server (cliente HTTP + credenciales) para el BackupManagerModal.
  server: { getClient(): import("./server/client").HTTPClient | null; getCreds(): import("./server/types").AuthCredentials | null } | null = null;

  // Solo los subsistemas esenciales se inicializan al arranque.
  // El resto se carga lazy cuando se necesitan.
  private audioRegistry!: AudioRegistry;
  private transcriber!: Transcriber;
  private audioRouter!: AudioRouter;
  private frontmatterManager!: FrontmatterManager;

  async onload() {
    this.log = new Logger("mnexus");
    this.log.info(`Device profile: ${device.type().toUpperCase()} (${device.profile().width}x${device.profile().height}, touch=${device.profile().isTouch})`);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // 1) Suscripción settings
    this.addSettingTab(new MNexusSettingTab(this.app, this));

    // 2) Núcleo ligero (audio + frontmatter)
    this.audioRegistry = new AudioRegistry(this.app, this.settings);
    this.transcriber = new Transcriber(this.app, this.settings, this.log, await loadWhisperInstaller() as any);
    this.audioRouter = new AudioRouter(this.app, this.settings, this.transcriber, this.log);
    this.frontmatterManager = new FrontmatterManager(this.app);

    // 3) Registrar comandos — cada uno carga su subsistema al invocarse
    this.registerCommands();

    // 4) Registrar vistas
    this.registerViews();

    // 5) Verificar backend al arranque (opcional)
    this.checkBackend();
  }

  /** Registra todos los comandos. Cada uno carga su subsistema lazy. */
  private registerCommands(): void {
    // Comandos básicos (no requieren subsistema pesado)
    this.addCommand({
      id: "mnexus-adaptive-quiz",
      name: "🧠 Quiz adaptativo — detecta lo que NO sabes",
      callback: () => this.openAdaptiveQuiz(),
    });

    this.addCommand({
      id: "mnexus-knowledge-stats",
      name: "📊 Ver tu temario y lagunas",
      callback: () => this.showKnowledgeStats(),
    });

    this.addCommand({
      id: "mnexus-show-proposals",
      name: "🤖 Ver propuestas de la IA",
      callback: () => this.openProposals(),
    });

    this.addCommand({
      id: "mnexus-annotation-toggle",
      name: "🖍️ Activar modo anotación",
      callback: () => this.toggleAnnotationMode(),
    });

    this.addCommand({
      id: "mnexus-voice-recorder",
      name: "🎙️ Grabar nota de voz",
      callback: () => this.startVoiceRecorder(),
    });

    this.addCommand({
      id: "mnexus-free-review",
      name: "📖 Repaso libre — estudia lo que tú quieras",
      callback: () => this.openFreeReview(),
    });

    // v0.28: Backup manager con drag-and-drop ultrarrápido
    this.addCommand({
      id: "mnexus-backup-manager",
      name: "📦 Gestor de backups (con drag-and-drop)",
      callback: () => this.openBackupManager(),
    });

    // Comandos lazy (cargan subsistema al invocarse)
    this.addCommand({
      id: "mnexus-flashcards-generate",
      name: "🃏 Generar flashcards",
      callback: async () => {
        const { FlashcardGenerator } = await loadFlashcardGenerator() as any;
        const gen = new FlashcardGenerator(this.app, this.settings, this.log, null, null);
        await gen.generate();
      },
    });

    this.addCommand({
      id: "mnexus-rag-search",
      name: "🔍 Búsqueda RAG",
      callback: async () => {
        const rag = await loadRAG() as any;
        // Init RAG on demand
      },
    });

    this.addCommand({
      id: "mnexus-coverage-audit",
      name: "📋 Auditoría de cobertura",
      callback: async () => {
        const { CoverageAuditor } = await loadCoverageAuditor() as any;
        const auditor = new CoverageAuditor(this.app, this.settings);
        await auditor.audit();
      },
    });

    this.addCommand({
      id: "mnexus-calendar-sync",
      name: "📅 Sincronizar calendario",
      callback: async () => {
        const { CalendarSync } = await loadCalendarSync() as any;
        const sync = new CalendarSync(this.app, this.settings, this.log);
        await sync.sync();
      },
    });

    this.addCommand({
      id: "mnexus-drawing",
      name: "✏️ Modo dibujo",
      callback: async () => {
        const { DrawingManager } = await loadDrawingManager() as any;
        const mgr = new DrawingManager(this.app, this.settings, this.log);
        mgr.activate();
      },
    });

    this.addCommand({
      id: "mnexus-handwritten-ocr",
      name: "📷 OCR de escritura a mano",
      callback: async () => {
        const { HandwrittenOcr } = await loadHandwrittenOcr() as any;
        const ocr = new HandwrittenOcr(this.app, this.settings, this.log);
        await ocr.process();
      },
    });
  }

  /** Registra las vistas. v0.28: views cargadas dinámicamente. */
  private registerViews(): void {
    // v0.28: ViewCreator de Obsidian no acepta Promise, pero el import dinámico sí.
    // Las views (Dashboard, Chat, Inbox) requieren subsistemas pesados (RAG, etc.)
    // que no se inicializan en el thin client. Por ahora, solo registramos Dashboard.
    const plugin = this as unknown as import("./plugin-api").PluginLike;
    this.registerView(VIEW_TYPE_DASHBOARD, ((leaf: WorkspaceLeaf) =>
      import("./ui/dashboard").then((m) => new m.DashboardView(leaf, plugin))) as any);
    // Chat y Inbox: desactivadas hasta que se implementen los subsistemas necesarios.
    // this.registerView(VIEW_TYPE_CHAT, ...);
    // this.registerView(VIEW_TYPE_INBOX, ...);
  }

  /** Verifica que el backend esté accesible. */
  private async checkBackend(): Promise<void> {
    const config = getBackendConfig(this as unknown as App);
    if (!config) return;
    try {
      const res = await fetch(`${config.url}/health`);
      if (res.ok) {
        this.log.info("[MNexus] backend OK");
      } else {
        this.log.warn("[MNexus] backend no disponible, modo offline");
      }
    } catch (e) {
      this.log.warn(`[MNexus] backend no accesible: ${(e as Error).message}`);
    }
  }

  // ── Comandos: delegan a HTTP client ──

  private async openAdaptiveQuiz(): Promise<void> {
    const { AdaptiveQuizModal } = await import("./ui/adaptiveQuizModal");
    const { KnowledgeGraph } = (await loadKnowledgeGraph() as any);
    const graph = new KnowledgeGraph();
    // Sembrar 5 concepts demo
    const { createConcept } = await loadKnowledgeGraph() as any;
    graph.add(createConcept("c1", "Diabetes mellitus tipo 2", { category: "Endocrinología" }));
    graph.add(createConcept("c2", "Hipertensión arterial", { category: "Cardiología" }));
    graph.add(createConcept("c3", "Asma bronquial", { category: "Neumología" }));
    graph.add(createConcept("c4", "Gastritis", { category: "Gastroenterología" }));
    graph.add(createConcept("c5", "Migraña", { category: "Neurología" }));
    new AdaptiveQuizModal(this.app, graph).open();
  }

  private async showKnowledgeStats(): Promise<void> {
    const { KnowledgeGraph } = (await loadKnowledgeGraph() as any);
    const graph = new KnowledgeGraph();
    // Stats rápidas
    new (this.app as any).Notice(`📊 Knowledge graph: ${graph.all().length} concepts (lazy init)`);
  }

  private async openProposals(): Promise<void> {
    const { ProposalsModal } = await import("./ui/proposalsModal");
    // Mock orchestrator con datos del backend
    const config = getBackendConfig(this as unknown as App);
    if (config) {
      const proposals = await backendGenerateProposals(config, {
        totalNotes: 0, totalWords: 0, totalFlashcards: 0,
        totalAudioNotes: 0, totalPdfNotes: 0,
        averageQuality: 0, untagged: [], orphaned: [], shortNotes: [], notesWithoutFlashcards: [],
        topics: [], subjects: [], gaps: [],
        evaluatedAt: Date.now(),
      }, [], { autoGenerateTypes: ["flashcards"], minScore: 0.3, maxPendingProposals: 10 });
      if (proposals) {
        // Mostrar proposals recibidas del backend
        new (this.app as any).Notice(`🤖 ${proposals.proposals.length} propuestas del backend`);
        return;
      }
    }
    new (this.app as any).Notice("⚠️ Backend no disponible");
  }

  private async toggleAnnotationMode(): Promise<void> {
    const { getAnnotationToolbar } = await import("./ui/annotationToolbar");
    const toolbar = getAnnotationToolbar(this);
    toolbar.toggle();
  }

  private async startVoiceRecorder(): Promise<void> {
    new (this.app as any).Notice("🎙️ Grabando... (funcionalidad en desarrollo)");
  }

  /** Abre el modal de repaso libre: "Hoy me apetece repasar anatomía". */
  private async openFreeReview(): Promise<void> {
    const { FreeReviewModal } = await import("./ui/freeReviewModal");
    // Recolectar todas las flashcards del vault
    // (en una versión más completa, esto se haría con un plugin adapter que
    // lee data.json del plugin; aquí lo simplificamos con un mock)
    const cards: any[] = [];
    // Cargar flashcards del plugin storage
    const data = (await this.loadData()) ?? {};
    if (Array.isArray(data.flashcards)) {
      for (const c of data.flashcards) {
        cards.push({
          id: c.id,
          front: c.front,
          back: c.back,
          notePath: c.notePath ?? "",
          tags: c.tags ?? [],
          fsrs: c.fsrs,
        });
      }
    }
    if (cards.length === 0) {
      new (this.app as any).Notice("⚠️ No hay flashcards en el vault. Crea algunas primero.");
      return;
    }
    new FreeReviewModal(this.app, cards).open();
  }

  // ── Stubs de métodos llamados por settings.ts ──
  // Algunos se implementan en subsistemas lazy; mientras tanto, stubs seguros.

  async openWhisperInstaller(): Promise<void> {
    new (this.app as any).Notice("🔧 Whisper installer (subsistema lazy)");
  }

  async checkWhisperInstalled(): Promise<{ installed: boolean }> {
    return { installed: false };
  }

  openOnboardingWizard(): void {
    new (this.app as any).Notice("🧙 Onboarding wizard");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async getAuthStatus(): Promise<{ configured: boolean; error?: string }> {
    return { configured: false, error: "No implementado en v0.28" };
  }

  async fetchAuditLog(): Promise<unknown[]> {
    return [];
  }

  async revokeTokens(): Promise<void> {
    new (this.app as any).Notice("🔑 Revoke tokens (no implementado)");
  }

  async generateE2EKey(): Promise<void> {
    new (this.app as any).Notice("🔐 Generate E2E key (no implementado)");
  }

  // ── v0.28: Stubs para métodos legacy llamados por settings.ts y UI ──
  // Estos delegan a subsistemas lazy o muestran notices. La mayoría son
  // no-críticos: el plugin funciona aunque fallen (UI los muestra como "soon").

  /** Abre el modal de calendario (lazy). */
  async openCalendarModal(): Promise<void> {
    const m = await import("./ui/calendarModal");
    // v0.28: CalendarModal requiere CalendarSync, pero el thin client no lo
    // inicializa. Mostramos notice como placeholder.
    new (this.app as any).Notice("📅 Calendar modal: requiere CalendarSync (no implementado en thin client)");
  }

  /** Ejecuta sync de calendario (no implementado offline-first). */
  async runCalendarSync(): Promise<{ events: number; matched: number }> {
    new (this.app as any).Notice("📅 Calendar sync: no implementado en v0.28");
    return { events: 0, matched: 0 };
  }

  /** Re-indexa el vault RAG. */
  async indexVaultAction(): Promise<{ indexed: number; skipped: number; failed: number }> {
    try {
      const { Indexer } = await import("./rag/indexer");
      const { VectorStore } = await import("./rag/vectorStore");
      const store = new VectorStore(this as any, this.log);
      const indexer = new Indexer(this.app, this.settings, this.log, store as any, {} as any);
      const result = await indexer.indexVault();
      return { indexed: result.indexed, skipped: result.skipped, failed: result.failed };
    } catch (e) {
      this.log.error("Index vault failed", { error: e as Error });
      return { indexed: 0, skipped: 0, failed: 1 };
    }
  }

  /** Autoriza Google Calendar (OAuth). */
  async authorizeGoogleCalendar(): Promise<void> {
    new (this.app as any).Notice("🔐 Google Calendar auth: configurar en settings");
  }

  /** Ejecuta Google Calendar sync. */
  async runGoogleCalendarSync(): Promise<{ events: number; matched: number }> {
    return { events: 0, matched: 0 };
  }

  /** Exporta E2E key con passphrase. */
  async exportE2EWithPassphrase(): Promise<void> {
    new (this.app as any).Notice("🔐 Export E2E: no implementado");
  }

  /** Importa E2E key con passphrase. */
  async importE2EWithPassphrase(): Promise<void> {
    new (this.app as any).Notice("🔐 Import E2E: no implementado");
  }

  /** Limpia la E2E key. */
  async clearE2EKey(): Promise<void> {
    new (this.app as any).Notice("🔐 Clear E2E: no implementado");
  }

  /** v0.28: WebDAV stubs (no implementado). */
  async testWebDavConnection(): Promise<boolean> {
    new (this.app as any).Notice("🔌 WebDAV: no implementado en v0.28");
    return false;
  }

  async runWebDavSync(): Promise<{ downloaded: number; uploaded: number; conflicts: number }> {
    return { downloaded: 0, uploaded: 0, conflicts: 0 };
  }

  /** v0.28: abre el BackupManagerModal con drag-and-drop. */
  async openBackupManager(): Promise<void> {
    const { BackupManagerModal } = await import("./ui/backupModal");
    const { LocalBackup } = await import("./backup/localBackup");
    const local = new LocalBackup(this.app, this.log);
    const modal = new BackupManagerModal(this.app, {
      local,
      client: () => this.server?.getClient() ?? null,
      creds: () => this.server?.getCreds() ?? null,
      log: this.log,
    });
    modal.open();
  }
}
