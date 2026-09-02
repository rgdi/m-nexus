// TemplateManager: gestiona los templates de flashcards.
// Carga los built-in al instalar, persiste los custom en la carpeta templatesFolder
// como archivos .json, y permite CRUD vía código y UI.

import { App, normalizePath, TFile } from "obsidian";
import { FlashcardTemplate } from "../types";
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID } from "./builtinTemplates";
import { Logger } from "../utils/logger";

export class TemplateManager {
  private custom: FlashcardTemplate[] = [];

  constructor(
    private app: App,
    private templatesFolder: string,
    private log: Logger
  ) {}

  /** Carga templates custom desde disco (idempotente). */
  async load(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.templatesFolder));
    if (!folder) {
      await this.ensureFolder();
      return;
    }
    this.custom = [];
    for (const child of (folder as unknown as { children?: TFile[] }).children ?? []) {
      if (!(child instanceof TFile)) continue;
      if (!child.name.endsWith(".json")) continue;
      try {
        const raw = await this.app.vault.read(child);
        const t = JSON.parse(raw) as FlashcardTemplate;
        if (t.id && t.name && t.subject && t.systemPrompt && t.userPrompt) {
          t.builtin = false;
          this.custom.push(t);
        }
      } catch (e) {
        this.log.warn(`Template inválido en ${child.path}: ${(e as Error).message}`);
      }
    }
    this.log.info(`Cargados ${this.custom.length} templates custom.`);
  }

  /** Devuelve todos los templates (built-in + custom). */
  all(): FlashcardTemplate[] {
    return [...BUILTIN_TEMPLATES, ...this.custom];
  }

  /** Devuelve el template por id. Lanza si no existe. */
  get(id: string): FlashcardTemplate {
    const t = this.all().find((x) => x.id === id);
    if (!t) throw new Error(`Template no encontrado: ${id}. Disponibles: ${this.all().map((x) => x.id).join(", ")}`);
    return t;
  }

  /** Busca el mejor template para una materia. Si no, devuelve el general. */
  forSubject(subject: string): FlashcardTemplate {
    const norm = subject.toLowerCase().trim();
    // 1) Match exacto
    const exact = this.all().find((t) => t.subject.toLowerCase() === norm);
    if (exact) return exact;
    // 2) Match parcial
    const partial = this.all().find(
      (t) => t.subject !== "general" && (norm.includes(t.subject.toLowerCase()) || t.subject.toLowerCase().includes(norm))
    );
    if (partial) return partial;
    return this.get(DEFAULT_TEMPLATE_ID);
  }

  /** Crea o actualiza un template custom. */
  async save(template: FlashcardTemplate): Promise<void> {
    template.builtin = false;
    const idx = this.custom.findIndex((t) => t.id === template.id);
    if (idx >= 0) this.custom[idx] = template;
    else this.custom.push(template);
    await this.persist(template);
  }

  async delete(id: string): Promise<void> {
    const t = this.custom.find((x) => x.id === id);
    if (!t) throw new Error(`Template custom no encontrado: ${id}`);
    this.custom = this.custom.filter((x) => x.id !== id);
    const file = this.app.vault.getAbstractFileByPath(this.pathFor(id));
    if (file instanceof TFile) await this.app.vault.delete(file);
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private pathFor(id: string): string {
    return normalizePath(`${this.templatesFolder}/${id}.json`);
  }

  private async ensureFolder(): Promise<void> {
    const norm = normalizePath(this.templatesFolder);
    if (await this.app.vault.adapter.exists(norm)) return;
    const parts = norm.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  private async persist(t: FlashcardTemplate): Promise<void> {
    await this.ensureFolder();
    const path = this.pathFor(t.id);
    const file = this.app.vault.getAbstractFileByPath(path);
    const body = JSON.stringify(t, null, 2);
    if (file instanceof TFile) await this.app.vault.modify(file, body);
    else await this.app.vault.create(path, body);
  }
}
