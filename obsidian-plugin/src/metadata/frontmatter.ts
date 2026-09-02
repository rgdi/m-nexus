// Parser y serializador del frontmatter M-NEXUS.
// Usa la lib `yaml` (sin dependencias pesadas).
// Mantiene el resto de la nota intacto: solo reemplaza el bloque --- ... ---.

import { App, parseFrontMatterTags, TFile } from "obsidian";
import * as yaml from "yaml";
import { MNexusFrontmatter } from "../types";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class FrontmatterManager {
  constructor(private app: App) {}

  /** Lee y devuelve el frontmatter (vacío si no existe). */
  async read(file: TFile): Promise<MNexusFrontmatter> {
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter) {
      return this.normalize(cache.frontmatter as Record<string, unknown>);
    }
    // Fallback: parsear manualmente si la caché no está lista.
    const raw = await this.app.vault.read(file);
    const parsed = this.parseRawFrontmatter(raw);
    return this.normalize(parsed);
  }

  /** Escribe (o actualiza) el frontmatter conservando el cuerpo. */
  async write(file: TFile, fm: MNexusFrontmatter): Promise<void> {
    const raw = await this.app.vault.read(file);
    const cleaned = fm.title ? fm : { ...fm, title: file.basename };
    const yamlString = yaml.stringify(this.toYamlObject(cleaned), {
      lineWidth: 0,
    });
    const newFrontmatter = `---\n${yamlString.replace(/\n+$/, "")}\n---\n`;

    let body: string;
    if (FRONTMATTER_REGEX.test(raw)) {
      body = raw.replace(FRONTMATTER_REGEX, "");
    } else {
      body = raw;
    }

    await this.app.vault.modify(file, newFrontmatter + body);
  }

  /** Mergea campos sin pisar los existentes. */
  async merge(file: TFile, patch: Partial<MNexusFrontmatter>): Promise<MNexusFrontmatter> {
    const current = await this.read(file);
    const next: MNexusFrontmatter = { ...current, ...patch };
    await this.write(file, next);
    return next;
  }

  /** Asegura que existan los campos mínimos para que la IA actúe. */
  async ensureSchema(file: TFile): Promise<MNexusFrontmatter> {
    const current = await this.read(file);
    const ensured: MNexusFrontmatter = {
      ...current,
      title: current.title || file.basename,
    };
    await this.write(file, ensured);
    return ensured;
  }

  // -------------------------------------------------------------------------

  private parseRawFrontmatter(raw: string): Record<string, unknown> {
    const match = raw.match(FRONTMATTER_REGEX);
    if (!match) return {};
    try {
      return (yaml.parse(match[1]) as Record<string, unknown>) || {};
    } catch {
      return {};
    }
  }

  private normalize(raw: Record<string, unknown>): MNexusFrontmatter {
    const tags = parseFrontMatterTags(raw) ?? [];
    const fm: MNexusFrontmatter = {
      title: typeof raw.title === "string" ? raw.title : "",
      subject: typeof raw.subject === "string" ? raw.subject : undefined,
      author_verified:
        typeof raw.author_verified === "boolean" ? raw.author_verified : undefined,
      exam_date: typeof raw.exam_date === "string" ? raw.exam_date : undefined,
      priority_level: this.toPriority(raw.priority_level),
      prof_audio_ref: typeof raw.prof_audio_ref === "string" ? raw.prof_audio_ref : undefined,
      pending_flashcard_review:
        typeof raw.pending_flashcard_review === "number" ? raw.pending_flashcard_review : undefined,
      fsrs_stability: typeof raw.fsrs_stability === "number" ? raw.fsrs_stability : undefined,
      fsrs_difficulty: typeof raw.fsrs_difficulty === "number" ? raw.fsrs_difficulty : undefined,
      next_due_date: typeof raw.next_due_date === "string" ? raw.next_due_date : undefined,
      has_handwritten_notes:
        typeof raw.has_handwritten_notes === "boolean" ? raw.has_handwritten_notes : undefined,
      handwritten_source:
        typeof raw.handwritten_source === "string" ? raw.handwritten_source : undefined,
      coverage_score: typeof raw.coverage_score === "number" ? raw.coverage_score : undefined,
      emphasis_blocks: Array.isArray(raw.emphasis_blocks)
        ? (raw.emphasis_blocks as string[])
        : undefined,
      last_audit: typeof raw.last_audit === "string" ? raw.last_audit : undefined,
    };
    // Saneado: si no hay tags, no los añadimos al objeto.
    if (tags.length > 0) (fm as unknown as Record<string, unknown>).tags = tags;
    return fm;
  }

  private toPriority(v: unknown): MNexusFrontmatter["priority_level"] {
    if (v === "High" || v === "Medium" || v === "Low") return v;
    return undefined;
  }

  private toYamlObject(fm: MNexusFrontmatter): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fm)) {
      if (value === undefined || value === null) continue;
      out[key] = value;
    }
    return out;
  }
}
