// FlashcardGenerator v2: usa LLM si está disponible, con template por materia.
// Si no hay LLM, usa el fallback local (definiciones, listas, headings).
// Si author_verified === false, devuelve [] (regla de control humano).

import { App, Notice, TFile } from "obsidian";
import { FlashcardDraft, LLMMessage, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";
import { FrontmatterManager } from "../metadata/frontmatter";
import { LLMManager } from "../llm/manager";
import { TemplateManager } from "./templates";
import { parseLlmResponse } from "./parser";

export interface GenerateOptions {
  /** Forzar un template concreto; si no, se infiere por subject. */
  templateId?: string;
  /** Forzar uso de LLM (true) o fallback local (false). Si undefined, decide automático. */
  useLlm?: boolean;
  /** Límite duro de tarjetas. */
  maxCards?: number;
}

export class FlashcardGenerator {
  private fm: FrontmatterManager;
  private templates: TemplateManager;
  private currentTemplate: ReturnType<TemplateManager["get"]> | null = null;

  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger,
    private llm: LLMManager,
    templates: TemplateManager
  ) {
    this.templates = templates;
    this.fm = new FrontmatterManager(app);
  }

  async generateForNote(file: TFile, options: GenerateOptions = {}): Promise<FlashcardDraft[]> {
    const fm = await this.fm.read(file);
    if (fm.author_verified === false) {
      this.log.warn(`Saltando ${file.path}: author_verified=false.`);
      return [];
    }
    const content = await this.app.vault.read(file);

    // Resolver template
    const template = options.templateId
      ? this.templates.get(options.templateId)
      : this.templates.forSubject(fm.subject ?? "general");
    this.currentTemplate = template;

    // Decidir estrategia
    const useLlm = options.useLlm ?? this.llm.isAvailable();
    let cards: FlashcardDraft[] = [];
    let warnings: string[] = [];

    if (useLlm) {
      // v0.11: intenta primero vía backend (más liviano, no carga LLM en el plugin).
      const remote = await this.generateRemote(file, content, fm, options.maxCards ?? 10);
      if (remote && remote.length > 0) {
        cards = remote;
        this.log.info(`[REMOTE] ${cards.length} tarjetas con template '${template.id}' para ${file.basename}.`);
      } else {
        try {
          cards = await this.generateWithLlm(file, template, content, fm, options.maxCards ?? 10);
          this.log.info(`[LLM-local] ${cards.length} tarjetas con template '${template.id}' para ${file.basename}.`);
        } catch (e) {
          this.log.error(`LLM falló: ${(e as Error).message}. Usando fallback local.`);
          warnings.push(`LLM error: ${(e as Error).message}`);
          cards = this.fallbackLocal(content, file, template, options.maxCards ?? 10);
        }
      }
    } else {
      cards = this.fallbackLocal(content, file, template, options.maxCards ?? 10);
      this.log.info(`[Local] ${cards.length} tarjetas (fallback) para ${file.basename}.`);
    }

    if (cards.length === 0) {
      new Notice("No se generaron tarjetas. Revisa la nota o el LLM.");
    }
    return cards;
  }

  // ─── LLM ──────────────────────────────────────────────────────────────

  /**
   * v0.11: Genera flashcards vía el backend (más liviano: solo envía la nota
   * y recibe los borradores ya parseados). El backend decide el estilo y el nivel.
   */
  private async generateRemote(
    file: TFile,
    content: string,
    fm: { subject?: string; title?: string },
    maxCards: number
  ): Promise<FlashcardDraft[] | null> {
    // Buscar el RemoteClient en main.ts (inyectado en el constructor)
    const remote = (this as unknown as { remoteClient?: { hasBackend: () => boolean; generateFlashcards: (req: unknown) => Promise<{ cards: Array<{ id: string; front: string; back: string; cardType: string; tags: string[] }> }> } })
      .remoteClient;
    if (!remote?.hasBackend()) return null;
    try {
      const style = (this.currentTemplate?.id === "cloze" || this.currentTemplate?.cardType === "cloze")
        ? "cloze" : "generic";
      const res = await remote.generateFlashcards({
        noteTitle: fm.title ?? file.basename,
        noteContent: this.truncate(content, 12000),
        frontmatter: fm as Record<string, string>,
        style,
        level: this.settings.userLevel,
        maxCards,
      });
      return res.cards.map((c) => ({
        id: c.id,
        front: c.front,
        back: c.back,
        cardType: (c.cardType as FlashcardDraft["cardType"]) ?? "basic",
        tags: c.tags,
        sourceNote: file.path,
        notePath: file.path,
        templateId: this.currentTemplate?.id ?? "unknown",
        createdAt: new Date().toISOString(),
        status: "draft" as const,
      }));
    } catch (e) {
      this.log.warn(`Remote flashcards falló: ${(e as Error).message}. Cayendo a generación local.`);
      return null;
    }
  }

  private async generateWithLlm(
    file: TFile,
    template: ReturnType<TemplateManager["get"]>,
    content: string,
    fm: { subject?: string; title?: string },
    maxCards: number
  ): Promise<FlashcardDraft[]> {
    const provider = this.llm.getProvider();
    if (!provider.isConfigured()) {
      throw new Error("Provider LLM no configurado");
    }
    const userPrompt = template.userPrompt
      .replace(/\{\{noteTitle\}\}/g, fm.title ?? file.basename)
      .replace(/\{\{noteContent\}\}/g, this.truncate(content, 12000))
      .replace(/\{\{subject\}\}/g, fm.subject ?? "general");

    const messages: LLMMessage[] = [
      { role: "system" as const, content: template.systemPrompt },
      { role: "user" as const, content: userPrompt + `\n\nMáximo: ${maxCards} tarjetas.` },
    ];
    const opts = {
      model: this.settings.llmModel,
      temperature: this.settings.llmTemperature,
      maxTokens: this.settings.llmMaxTokens,
      responseFormat: template.parserStrategy === "json" ? ("json" as const) : ("text" as const),
    };
    const raw = await provider.chat(messages, opts);
    const parsed = parseLlmResponse(raw, template, file.path);
    for (const w of parsed.warnings) this.log.warn(`Parser: ${w}`);
    // v0.5: el LLM ya incluyó cardType en cada tarjeta. Si no, enriquecemos
    // con la heurística auto-types.
    const { enrichDraftsWithAutoType } = await import("./autoTypes");
    return enrichDraftsWithAutoType(parsed.cards.slice(0, maxCards), this.llm, this.log);
  }

  // ─── Fallback local ───────────────────────────────────────────────────

  private fallbackLocal(
    content: string,
    file: TFile,
    template: ReturnType<TemplateManager["get"]>,
    maxCards: number
  ): FlashcardDraft[] {
    const strategy = template.localFallback;
    let raw: string;
    if (strategy === "definitions") raw = JSON.stringify(this.extractDefinitions(content));
    else if (strategy === "lists") raw = JSON.stringify(this.extractLists(content));
    else if (strategy === "headings") raw = JSON.stringify(this.extractHeadings(content));
    else raw = "[]";
    const parsed = parseLlmResponse(raw, template, file.path);
    return parsed.cards.slice(0, maxCards);
  }

  private extractDefinitions(content: string): { front: string; back: string; tags: string[] }[] {
    const out: { front: string; back: string; tags: string[] }[] = [];
    const lines = content.split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const h = line.match(/^#{1,3}\s+(.+)$/);
      if (h) {
        section = h[1].trim();
        continue;
      }
      const def = line.match(/^\s*\*?\*?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\s\-]{2,60})\*?\*?\s*[:\-–—]\s+(.{20,})$/);
      if (def) {
        out.push({ front: `¿Qué es/qué significa **${def[1].trim()}**?`, back: def[2].trim(), tags: [section] });
      }
    }
    return out;
  }

  private extractLists(content: string): { front: string; back: string; tags: string[] }[] {
    const out: { front: string; back: string; tags: string[] }[] = [];
    const lines = content.split(/\r?\n/);
    let section = "";
    for (const line of lines) {
      const h = line.match(/^#{1,3}\s+(.+)$/);
      if (h) {
        section = h[1].trim();
        continue;
      }
      const li = line.match(/^\s*\d+\.\s+(.{10,})$/);
      if (li && section) {
        out.push({ front: `Enumera los puntos clave de: ${section}`, back: li[1], tags: [section] });
      }
    }
    return out;
  }

  private extractHeadings(content: string): { front: string; back: string; tags: string[] }[] {
    const out: { front: string; back: string; tags: string[] }[] = [];
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(/^#{1,3}\s+(.+)$/);
      if (!h) continue;
      // Cuerpo siguiente hasta el próximo heading
      const bodyLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^#{1,3}\s+/.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }
      const body = bodyLines.join("\n").trim();
      if (body.length > 30) {
        out.push({ front: `Resume: ${h[1].trim()}`, back: body.slice(0, 400), tags: [h[1].trim()] });
      }
    }
    return out;
  }

  private truncate(s: string, n: number): string {
    if (s.length <= n) return s;
    return s.slice(0, n) + "\n\n[... truncado ...]";
  }
}
