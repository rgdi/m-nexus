// Cola de flashcards v2: soporta múltiples tipos de tarjeta (basic, cloze, list, etc.).
// Cada tipo tiene su render Markdown. Las aprobadas se persisten con frontmatter FSRS.

import { App, normalizePath, TFile, TFolder } from "obsidian";
import { FlashcardDraft, MNexusSettings, FsrsState, CardType } from "../types";
import { Logger } from "../utils/logger";
import { newCard } from "../fsrs/scheduler";

const DRAFT_TAG = "mnexus/flashcard-draft";

export class FlashcardQueue {
  constructor(private app: App, private settings: MNexusSettings, private log: Logger) {}

  async enqueue(cards: FlashcardDraft[]): Promise<number> {
    if (cards.length === 0) return 0;
    await this.ensureFolder(this.settings.flashcardsDraftFolder);
    let count = 0;
    for (const c of cards) {
      const safeId = c.id.replace(/[^\w\-]/g, "_");
      const path = normalizePath(`${this.settings.flashcardsDraftFolder}/${safeId}.md`);
      const body = this.renderDraft(c);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, body);
      } else {
        await this.app.vault.create(path, body);
      }
      count++;
    }
    this.log.info(`Encolados ${count} borradores.`);
    return count;
  }

  async listDrafts(): Promise<FlashcardDraft[]> {
    const folder = this.app.vault.getAbstractFileByPath(
      normalizePath(this.settings.flashcardsDraftFolder)
    );
    if (!(folder instanceof TFolder)) return [];
    const out: FlashcardDraft[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile)) continue;
      const fm = this.app.metadataCache.getFileCache(child)?.frontmatter;
      if (!fm || fm[DRAFT_TAG] !== true) continue;
      const raw = await this.app.vault.read(child);
      out.push(this.parseDraftFile(child, raw, fm as Record<string, unknown>));
    }
    return out;
  }

  async approve(draftId: string): Promise<TFile | undefined> {
    const drafts = await this.listDrafts();
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) {
      this.log.warn(`Borrador ${draftId} no encontrado.`);
      return undefined;
    }
    await this.ensureFolder(this.settings.flashcardsApprovedFolder);
    const initial = newCard();
    const fsrsState: FsrsState = {
      stability: initial.stability,
      difficulty: initial.difficulty,
      dueDate: initial.dueDate.toISOString(),
      reps: initial.reps,
      lapses: initial.lapses,
    };
    draft.status = "approved";
    draft.fsrs = fsrsState;
    const safeId = draft.id.replace(/[^\w\-]/g, "_");
    const dest = normalizePath(`${this.settings.flashcardsApprovedFolder}/${safeId}.md`);
    await this.app.vault.create(dest, this.renderApproved(draft));
    const orig = this.app.vault.getAbstractFileByPath(
      normalizePath(`${this.settings.flashcardsDraftFolder}/${safeId}.md`)
    );
    if (orig instanceof TFile) await this.app.vault.delete(orig);
    this.log.info(`Aprobada tarjeta ${safeId} → ${dest}`);
    return this.app.vault.getAbstractFileByPath(dest) as TFile;
  }

  async reject(draftId: string): Promise<void> {
    const safeId = draftId.replace(/[^\w\-]/g, "_");
    const path = normalizePath(`${this.settings.flashcardsDraftFolder}/${safeId}.md`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.delete(f);
  }

  // ─── Renderers ────────────────────────────────────────────────────────

  private renderDraft(c: FlashcardDraft): string {
    const fm = [
      "---",
      `${DRAFT_TAG}: true`,
      `note: "${c.notePath}"`,
      `status: "${c.status}"`,
      `template: "${c.templateId ?? "unknown"}"`,
      `card_type: "${c.cardType ?? "basic"}"`,
      `created: "${c.createdAt}"`,
      `tags: [${c.tags.map((t) => `"${t}"`).join(", ")}]`,
      c.extra ? `extra: ${JSON.stringify(c.extra)}` : "",
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    return fm + this.renderBody(c, "Borrador");
  }

  private renderApproved(c: FlashcardDraft): string {
    const fmLines = [
      "---",
      "mnexus/flashcard-approved: true",
      `note: "${c.notePath}"`,
      `created: "${c.createdAt}"`,
      `approved: "${new Date().toISOString()}"`,
      `template: "${c.templateId ?? "unknown"}"`,
      `card_type: "${c.cardType ?? "basic"}"`,
    ];
    if (c.fsrs) {
      fmLines.push(
        `fsrs_stability: ${c.fsrs.stability}`,
        `fsrs_difficulty: ${c.fsrs.difficulty}`,
        `next_due_date: "${c.fsrs.dueDate}"`,
        `reps: ${c.fsrs.reps}`,
        `lapses: ${c.fsrs.lapses}`
      );
    }
    fmLines.push(`tags: [${c.tags.map((t) => `"${t}"`).join(", ")}]`);
    if (c.extra) fmLines.push(`extra: ${JSON.stringify(c.extra)}`);
    fmLines.push("---\n");
    return fmLines.join("\n") + this.renderBody(c, c.tags[0] ?? "Flashcard");
  }

  /** Render del cuerpo de la tarjeta según su tipo. */
  private renderBody(c: FlashcardDraft, title: string): string {
    const type: CardType = c.cardType ?? "basic";
    const out: string[] = [`# ${title}`, ""];

    if (type === "cloze") {
      out.push(c.front, "", "***", "", c.back, "");
    } else if (type === "reversed") {
      // Dos secciones invertidas: alumno puede preguntarse en ambas direcciones
      out.push("**A → B:**", "", c.front, "", "***", "", "**B → A:**", "", c.back, "");
    } else if (type === "list") {
      out.push("**Pregunta:**", c.front, "", "***", "", "**Respuesta:**", c.back, "");
    } else if (type === "image-occlusion") {
      const ref = (c.extra?.imageRef as string) ?? "(imagen no especificada)";
      out.push("**Imagen:**", `![[${ref}]]`, "", "***", "", c.front, "", c.back, "");
    } else {
      // basic + freeform
      out.push(c.front, "", "***", "", c.back, "");
    }
    return out.join("\n") + "\n";
  }

  private parseDraftFile(file: TFile, raw: string, fm: Record<string, unknown>): FlashcardDraft {
    const m = raw.match(/^#\s+.+?\n+([\s\S]*?)\n+\*\*\*\n+([\s\S]*?)$/);
    const front = m ? m[1].trim() : file.basename;
    const back = m ? m[2].trim() : "";
    return {
      id: file.basename,
      notePath: (fm.note as string) ?? "",
      templateId: (fm.template as string) ?? "unknown",
      cardType: (fm.card_type as CardType) ?? "basic",
      front,
      back,
      tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
      sourceBlock: undefined,
      createdAt: (fm.created as string) ?? new Date().toISOString(),
      status: "draft",
      extra: this.parseExtra(fm.extra),
    };
  }

  private parseExtra(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
    if (raw && typeof raw === "object") return raw as Record<string, unknown>;
    return undefined;
  }

  private async ensureFolder(p: string) {
    const norm = normalizePath(p);
    if (await this.app.vault.adapter.exists(norm)) return;
    const parts = norm.split("/");
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}
