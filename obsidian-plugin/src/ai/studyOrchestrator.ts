// ⚠️ DEPRECATED v0.28: Esta lógica se ejecuta en el backend.
// El plugin debe usar src/services/aiClient.ts en su lugar.
// Esta implementación se mantiene solo como fallback offline y para tests.
// Migrar a backend: import { backendEvalVault, backendGenerateProposals, etc. } from './services/aiClient';
// v0.28: StudyOrchestrator — el agente IA que coordina RAG, evaluación y propuestas.
// Human-in-the-loop: solo aplica propuestas aprobadas.

import { App, Notice } from "obsidian";
import { VaultEvaluator, type VaultEvaluation, type NoteSnapshot } from "./vaultEvaluator";
import { ProposalStore, type Proposal, genProposalId } from "./contentProposals";
import type { KnowledgeGraph } from "../study/knowledgeLayers";
import { KnowledgeGraph as KnowledgeGraphClass } from "../study/knowledgeLayers";
import { createConcept } from "../study/knowledgeLayers";
import type { PluginDataStorage } from "../exams/persistence";

export interface OrchestratorConfig {
  /** Cada cuánto ejecuta análisis automático. */
  autoRunIntervalMs: number;
  /** Tipos de propuestas que genera automáticamente. */
  autoGenerateTypes: Array<"summary" | "flashcards" | "link-suggestion" | "tag-suggestion" | "reorganize" | "gap-fill">;
  /** Si aprueba automáticamente propuestas de baja prioridad. */
  autoApproveLowPriority: boolean;
  /** Máximo de propuestas pendientes en el panel. */
  maxPendingProposals: number;
  /** Score mínimo para proponer (0..1). */
  minScore: number;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  autoRunIntervalMs: 24 * 3600_000, // 24h
  autoGenerateTypes: ["summary", "flashcards", "link-suggestion", "tag-suggestion", "gap-fill"],
  autoApproveLowPriority: false,
  maxPendingProposals: 20,
  minScore: 0.5,
};

export class StudyOrchestrator {
  private app: App;
  private config: OrchestratorConfig;
  private evaluator: VaultEvaluator;
  private proposals: ProposalStore;
  private knowledgeGraph: KnowledgeGraph;
  private storage?: PluginDataStorage;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastEvaluation: VaultEvaluation | null = null;
  private onProposal?: (p: Proposal) => void;
  private log: { info: (msg: string) => void; warn: (msg: string) => void };

  constructor(
    app: App,
    knowledgeGraphOrConfig?: KnowledgeGraph | Partial<OrchestratorConfig>,
    storage?: PluginDataStorage,
    log?: { info: (msg: string) => void; warn: (msg: string) => void },
    configOrUndefined?: Partial<OrchestratorConfig>,
  ) {
    // Soporte para dos firmas:
    //   new StudyOrchestrator(app, { ...config })
    //   new StudyOrchestrator(app, knowledgeGraph, storage, log, config)
    let kg: KnowledgeGraph;
    let lg: { info: (msg: string) => void; warn: (msg: string) => void };
    let st: PluginDataStorage | undefined;
    let cfg: Partial<OrchestratorConfig>;
    if (
      knowledgeGraphOrConfig &&
      typeof (knowledgeGraphOrConfig as KnowledgeGraph).add === "function" &&
      typeof (knowledgeGraphOrConfig as KnowledgeGraph).get === "function"
    ) {
      // Firma con knowledgeGraph
      kg = knowledgeGraphOrConfig as KnowledgeGraph;
      st = storage;
      lg = log ?? { info: () => {}, warn: () => {} };
      cfg = configOrUndefined ?? {};
    } else {
      // Firma con solo config
      kg = new KnowledgeGraphClass();
      st = undefined;
      lg = { info: () => {}, warn: () => {} };
      cfg = (knowledgeGraphOrConfig as Partial<OrchestratorConfig>) ?? {};
    }
    this.app = app;
    this.knowledgeGraph = kg;
    this.storage = st;
    this.log = lg;
    this.config = { ...DEFAULT_CONFIG, ...cfg };
    this.evaluator = new VaultEvaluator();
    this.proposals = new ProposalStore();
  }

  /** Configura el callback para notificar cuando hay nueva propuesta. */
  onNewProposal(cb: (p: Proposal) => void): void {
    this.onProposal = cb;
  }

  /** Acceso al ProposalStore. */
  getProposals(): ProposalStore {
    return this.proposals;
  }

  /** Aprueba una proposal (human-in-the-loop). */
  approveProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p) return false;
    if (p.status !== "pending") return false;
    this.proposals.approve(id);
    return true;
  }

  /** Rechaza una proposal. */
  rejectProposal(id: string): boolean {
    const p = this.proposals.get(id);
    if (!p) return false;
    if (p.status !== "pending") return false;
    this.proposals.reject(id);
    return true;
  }

  /** Última evaluación. */
  getLastEvaluation(): VaultEvaluation | null {
    return this.lastEvaluation;
  }

  /** Inicia el agente. */
  start(): void {
    if (this.intervalHandle) return;
    // Análisis inicial al arrancar
    void this.runAnalysis();
    // Y cada N ms
    this.intervalHandle = setInterval(() => {
      void this.runAnalysis();
    }, this.config.autoRunIntervalMs);
    this.log.info(`[Orchestrator] started, next run in ${this.config.autoRunIntervalMs / 1000}s`);
  }

  /** Detiene el agente. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Ejecuta un análisis completo del vault. */
  async runAnalysis(): Promise<VaultEvaluation> {
    this.log.info("[Orchestrator] running analysis...");
    const files = this.app.vault.getMarkdownFiles();
    const snapshots: NoteSnapshot[] = [];

    for (const f of files) {
      try {
        const content = await this.app.vault.read(f as any);
        const fm = (this.app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
        const snap: NoteSnapshot = {
          path: f.path,
          basename: f.basename,
          content,
          size: content.length,
          modifiedAt: (f as any).stat?.mtime ?? Date.now(),
          frontmatter: fm,
          tags: this.extractTags(content, fm),
          links: this.extractLinks(content),
          wordCount: content.split(/\s+/).filter((w) => w.length > 0).length,
          hasAudio: f.path.includes("Audio/"),
          hasPdf: f.path.includes(".pdf"),
          hasFlashcards: content.includes("## Card ") || fm.type === "flashcard",
          topic: (fm.subject as string) ?? (fm.topic as string) ?? null,
        };
        snapshots.push(snap);
      } catch (err) {
        this.log.warn(`[Orchestrator] failed to read ${f.path}: ${(err as Error).message}`);
      }
    }

    const evaluation = this.evaluator.evaluate(snapshots);
    this.lastEvaluation = evaluation;
    this.log.info(`[Orchestrator] evaluation done: ${evaluation.totalNotes} notes, ${evaluation.gaps.length} gaps, ${evaluation.untagged.length} untagged`);

    // Auto-poblar knowledge graph con subjects detectados
    this.populateKnowledgeGraph(evaluation);

    // Generar propuestas basadas en la evaluación
    await this.generateProposals(evaluation, snapshots);

    return evaluation;
  }

  /** Llena el knowledge graph con los subjects. */
  private populateKnowledgeGraph(evaluation: VaultEvaluation): void {
    let added = 0;
    for (const subj of evaluation.subjects) {
      if (this.knowledgeGraph.findByTerm(subj.name) === null) {
        const concept = createConcept(`subj-${subj.name.toLowerCase().replace(/\s+/g, "-")}`, subj.name, {
          category: subj.name,
          tags: ["auto-generated"],
        });
        this.knowledgeGraph.add(concept);
        added++;
      }
    }
    if (added > 0) this.log.info(`[Orchestrator] added ${added} concepts to knowledge graph`);
  }

  /** Genera propuestas basadas en la evaluación. */
  private async generateProposals(evaluation: VaultEvaluation, snapshots: NoteSnapshot[]): Promise<void> {
    // 1) Notas sin flashcards → proponer flashcards
    for (const note of evaluation.notesWithoutFlashcards.slice(0, 5)) {
      if (this.proposals.list({ type: "flashcards", status: "pending" }).some((p) => "sourceNote" in p && p.sourceNote === note.path)) {
        continue; // ya hay una propuesta
      }
      const cards = this.generateFlashcardsFromContent(note.content, note.topic);
      if (cards.length === 0) continue;
      this.addProposal({
        id: genProposalId(),
        type: "flashcards",
        title: `Crear ${cards.length} flashcards de "${note.basename}"`,
        description: `La nota tiene contenido valioso pero sin flashcards. Generaré ${cards.length} cards automáticamente.`,
        reasoning: `Nota sin flashcards detectada (${note.wordCount} palabras, sin # Card headers)`,
        confidence: 0.75,
        priority: 0.7,
        status: "pending",
        createdAt: Date.now(),
        requiresDoubleApproval: false,
        tags: ["auto", "flashcards"],
        sourceNote: note.path,
        cards,
        targetFolder: "Flashcards",
      });
    }

    // 2) Notas sin tags → sugerir tags
    for (const note of evaluation.untagged.slice(0, 5)) {
      if (this.proposals.list({ type: "tag-suggestion", status: "pending" }).some((p) => "notePath" in p && p.notePath === note.path)) {
        continue;
      }
      const suggested = this.suggestTags(note);
      if (suggested.length === 0) continue;
      this.addProposal({
        id: genProposalId(),
        type: "tag-suggestion",
        title: `Añadir tags a "${note.basename}"`,
        description: `La nota no tiene tags. Sugeridos: ${suggested.join(", ")}`,
        reasoning: "Nota sin tags detectada",
        confidence: 0.6,
        priority: 0.4,
        status: "pending",
        createdAt: Date.now(),
        requiresDoubleApproval: false,
        tags: ["auto", "tags"],
        notePath: note.path,
        currentTags: note.tags,
        suggestedTags: suggested,
        reason: "Sin tags",
      });
    }

    // 3) Huérfanas sin links → sugerir links a notas relacionadas
    for (const note of evaluation.orphaned.slice(0, 3)) {
      const related = this.findRelatedNotes(note, snapshots);
      for (const target of related.slice(0, 2)) {
        this.addProposal({
          id: genProposalId(),
          type: "link-suggestion",
          title: `Enlazar "${note.basename}" con "${target.basename}"`,
          description: `Añadir [[${target.basename}]] en una frase relevante.`,
          reasoning: "Ambas notas mencionan el mismo tema pero no están enlazadas",
          confidence: 0.65,
          priority: 0.5,
          status: "pending",
          createdAt: Date.now(),
          requiresDoubleApproval: false,
          tags: ["auto", "links"],
          sourceNote: note.path,
          targetNote: target.path,
          targetText: target.basename,
          reason: "Mismo topic sin enlace",
        });
      }
    }

    // 4) Gaps temáticos → sugerir crear nota
    for (const gap of evaluation.gaps.slice(0, 3)) {
      if (this.proposals.list({ type: "gap-fill", status: "pending" }).some((p) => "topic" in p && p.topic === gap.topic)) {
        continue;
      }
      this.addProposal({
        id: genProposalId(),
        type: "gap-fill",
        title: `Crear nota sobre "${gap.topic}"`,
        description: `Detecté que este tema tiene poca cobertura. Te propongo un esqueleto inicial.`,
        reasoning: gap.reason,
        confidence: 0.5,
        priority: gap.priority,
        status: "pending",
        createdAt: Date.now(),
        requiresDoubleApproval: true,
        tags: ["auto", "gap"],
        topic: gap.topic,
        skeleton: `# ${gap.topic}\n\n## Definición\n\n[pendiente]\n\n## Conceptos clave\n\n- [pendiente]\n- [pendiente]\n\n## Aplicaciones\n\n[pendiente]\n\n## Referencias\n\n`,
        sources: [],
      });
    }

    // 5) Notas largas sin resumen → proponer resumen
    for (const note of snapshots.filter((n) => n.wordCount > 800 && !this.hasSummary(n)).slice(0, 3)) {
      this.addProposal({
        id: genProposalId(),
        type: "summary",
        title: `Resumir "${note.basename}"`,
        description: `La nota tiene ${note.wordCount} palabras. Genero un resumen ejecutivo.`,
        reasoning: "Nota larga sin resumen (heurístico)",
        confidence: 0.6,
        priority: 0.5,
        status: "pending",
        createdAt: Date.now(),
        requiresDoubleApproval: false,
        tags: ["auto", "summary"],
        sourceNote: note.path,
        summary: this.generateSummaryFromContent(note.content),
        keyPoints: this.extractKeyPoints(note.content, 5),
        length: "medium",
      });
    }
  }

  /** Aplica una propuesta aprobada. */
  async applyProposal(id: string): Promise<boolean> {
    const p = this.proposals.get(id);
    if (!p) return false;
    if (p.status !== "approved") {
      this.log.warn(`[Orchestrator] cannot apply proposal ${id}: status is ${p.status}`);
      return false;
    }
    try {
      switch (p.type) {
        case "summary":
          await this.applySummary(p);
          break;
        case "flashcards":
          await this.applyFlashcards(p);
          break;
        case "tag-suggestion":
          await this.applyTags(p);
          break;
        case "link-suggestion":
          await this.applyLink(p);
          break;
        case "gap-fill":
          await this.applyGapFill(p);
          break;
        case "reorganize":
          await this.applyReorganize(p);
          break;
        default:
          this.log.warn(`[Orchestrator] apply not implemented for type ${p.type}`);
          return false;
      }
      this.proposals.markApplied(id);
      new Notice(`✅ Propuesta aplicada: ${p.title}`);
      return true;
    } catch (err) {
      this.proposals.markFailed(id);
      this.log.warn(`[Orchestrator] apply failed: ${(err as Error).message}`);
      new Notice(`❌ Error aplicando propuesta: ${(err as Error).message}`);
      return false;
    }
  }

  private async applySummary(p: Proposal): Promise<void> {
    if (p.type !== "summary") return;
    const f = this.app.vault.getAbstractFileByPath(p.sourceNote);
    if (!f || typeof f.path !== "string") throw new Error("source note not found");
    const content = await this.app.vault.read(f as any);
    const summary = `# Resumen ejecutivo de ${p.sourceNote}\n\n${p.summary}\n\n## Puntos clave\n\n${p.keyPoints.map((k) => `- ${k}`).join("\n")}\n`;
    const newContent = summary + "\n---\n\n" + content;
    await this.app.vault.modify(f as any, newContent);
  }

  private async applyFlashcards(p: Proposal): Promise<void> {
    if (p.type !== "flashcards") return;
    const folder = p.targetFolder;
    const folderFile = this.app.vault.getAbstractFileByPath(folder);
    if (!folderFile) {
      await this.app.vault.createFolder(folder);
    }
    const deckContent = this.renderFlashcardsDeck(p.sourceNote, p.cards);
    const deckPath = `${folder}/${this.basename(p.sourceNote)}-deck.md`;
    const existing = this.app.vault.getAbstractFileByPath(deckPath);
    if (existing && typeof existing.path === "string") {
      await this.app.vault.modify(existing as any, deckContent);
    } else {
      await this.app.vault.create(deckPath as any, deckContent);
    }
  }

  private async applyTags(p: Proposal): Promise<void> {
    if (p.type !== "tag-suggestion") return;
    const f = this.app.vault.getAbstractFileByPath(p.notePath);
    if (!f || typeof f.path !== "string") throw new Error("note not found");
    await this.app.fileManager.processFrontMatter(f as any, (fm) => {
      const current = (fm.tags as string[] | undefined) ?? [];
      const merged = Array.from(new Set([...current, ...p.suggestedTags]));
      fm.tags = merged;
    });
  }

  private async applyLink(p: Proposal): Promise<void> {
    if (p.type !== "link-suggestion") return;
    const f = this.app.vault.getAbstractFileByPath(p.sourceNote);
    if (!f || typeof f.path !== "string") throw new Error("source not found");
    const content = await this.app.vault.read(f as any);
    // Reemplazar la primera ocurrencia del texto con [[link]]
    const idx = content.toLowerCase().indexOf(p.targetText.toLowerCase());
    if (idx === -1) return;
    const before = content.slice(0, idx);
    const after = content.slice(idx + p.targetText.length);
    const newContent = `${before}[[${p.targetText}]]${after}`;
    await this.app.vault.modify(f as any, newContent);
  }

  private async applyGapFill(p: Proposal): Promise<void> {
    if (p.type !== "gap-fill") return;
    const path = `${p.topic.replace(/[^\w\sáéíóúüñ-]/gi, "").replace(/\s+/g, "-")}.md`;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && typeof existing.path === "string") {
      // Ya existe, añadir sección
      const content = await this.app.vault.read(existing as any);
      await this.app.vault.modify(existing as any, content + "\n\n## Apuntes adicionales\n\n" + p.skeleton);
    } else {
      await this.app.vault.create(path as any, p.skeleton);
    }
  }

  private async applyReorganize(p: Proposal): Promise<void> {
    if (p.type !== "reorganize") return;
    const f = this.app.vault.getAbstractFileByPath(p.notePath);
    if (!f || typeof f.path !== "string") throw new Error("note not found");
    const newPath = `${p.suggestedFolder}/${f.name}`;
    if (!this.app.vault.getAbstractFileByPath(p.suggestedFolder)) {
      await this.app.vault.createFolder(p.suggestedFolder);
    }
    await this.app.fileManager.renameFile(f, newPath);
  }

  private addProposal(p: Proposal): void {
    this.proposals.add(p);
    if (this.onProposal) this.onProposal(p);
  }

  // ─── Helpers heurísticos (sin LLM, pero extensibles) ─────

  private extractTags(content: string, fm: Record<string, unknown>): string[] {
    const tags = new Set<string>();
    if (Array.isArray(fm.tags)) for (const t of fm.tags) tags.add(String(t));
    const inline = content.match(/(?:^|\s)#[\wáéíóúüñ-]+/gi) ?? [];
    for (const m of inline) {
      const t = m.trim().replace(/^#/, "");
      if (t && t.length > 2) tags.add(t);
    }
    return Array.from(tags);
  }

  private extractLinks(content: string): string[] {
    const m = content.match(/\[\[([^\]]+)\]\]/g) ?? [];
    return m.map((s) => s.slice(2, -2).split("|")[0]);
  }

  private generateFlashcardsFromContent(content: string, topic: string | null): Array<{ front: string; back: string }> {
    const cards: Array<{ front: string; back: string }> = [];
    // Heurística: preguntas-respuestas basadas en listas
    const lines = content.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line.startsWith("## ") || line.startsWith("# ")) {
        const header = line.replace(/^#+\s*/, "");
        // Tomar el primer bullet como respuesta
        for (let j = i + 1; j < lines.length && j < i + 5; j++) {
          const next = lines[j].trim();
          if (next.startsWith("- ") || next.startsWith("* ")) {
            cards.push({
              front: `¿Qué es/son ${header}?`,
              back: next.slice(2).trim(),
            });
            break;
          }
        }
      }
      if (cards.length >= 5) break;
    }
    // Si no hay nada, crear al menos una
    if (cards.length === 0 && topic) {
      cards.push({ front: `¿Qué sabes sobre ${topic}?`, back: "Revisa la nota y extrae los puntos clave." });
    }
    return cards;
  }

  private suggestTags(note: NoteSnapshot): string[] {
    const tags = new Set<string>();
    // Tags del topic
    if (note.topic) tags.add(note.topic.toLowerCase().replace(/\s+/g, "-"));
    // Tags del path (carpeta)
    const parts = note.path.split("/");
    if (parts.length > 1) tags.add(parts[0].toLowerCase());
    // Tags heurísticos
    const content = note.content.toLowerCase();
    if (content.includes("anatomía") || content.includes("anatomia")) tags.add("anatomia");
    if (content.includes("bioquímica") || content.includes("bioquimica")) tags.add("bioquimica");
    if (content.includes("fisiología") || content.includes("fisiologia")) tags.add("fisiologia");
    if (content.includes("farmacología") || content.includes("farmacologia")) tags.add("farmacologia");
    return Array.from(tags).filter((t) => !note.tags.includes(t)).slice(0, 4);
  }

  private findRelatedNotes(note: NoteSnapshot, all: NoteSnapshot[]): NoteSnapshot[] {
    const noteWords = new Set(this.tokenize(note.content));
    return all
      .filter((n) => n.path !== note.path)
      .map((n) => ({
        note: n,
        score: this.jaccard(noteWords, this.tokenize(n.content)),
      }))
      .filter((r) => r.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.note);
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 4),
    );
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    let inter = 0;
    for (const w of a) if (b.has(w)) inter++;
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
  }

  private hasSummary(note: NoteSnapshot): boolean {
    return note.content.toLowerCase().includes("# resumen") || note.content.toLowerCase().includes("## resumen");
  }

  private generateSummaryFromContent(content: string): string {
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const intro = lines.find((l) => l.startsWith("# ")) ?? "Resumen";
    const keySentences = lines
      .filter((l) => !l.startsWith("#") && l.length > 30 && l.length < 200)
      .slice(0, 3);
    return `${intro}\n\n${keySentences.join(" ")}`;
  }

  private extractKeyPoints(content: string, n: number): string[] {
    return content
      .split("\n")
      .filter((l) => l.startsWith("- ") || l.startsWith("* "))
      .map((l) => l.replace(/^[-*]\s*/, "").trim())
      .filter((l) => l.length > 10)
      .slice(0, n);
  }

  private renderFlashcardsDeck(source: string, cards: Array<{ front: string; back: string; cardType?: string; tags?: string[] }>): string {
    const header = `---\nmnexus_version: "1.0"\ntype: flashcards-deck\nsource: "[[${this.basename(source)}]]"\ntags: [auto-generated]\n---\n\n# Deck: ${this.basename(source)}\n\n`;
    const body = cards.map((c, i) => `## Card ${i + 1}\n### Front\n${c.front}\n\n### Back\n${c.back}\n`).join("\n---\n\n");
    return header + body;
  }

  private basename(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  }
}
