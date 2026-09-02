// v0.28: VaultEvaluator — evalúa el estado del vault con logging exhaustivo.
// Detecta: notas huérfanas, gaps temáticos, duplicados, oportunidades de flashcards.
//
// ⚠️ DEPRECATED: Esta lógica se ejecuta en el backend vía /vault/eval.
// Esta implementación se mantiene como fallback offline y para tests.

import type { TFile } from "obsidian";
import { Logger } from "../utils/logger";

const log = new Logger("vault-evaluator");

export interface NoteSnapshot {
  path: string;
  basename: string;
  content: string;
  size: number;
  modifiedAt: number;
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
  wordCount: number;
  hasAudio: boolean;
  hasPdf: boolean;
  hasFlashcards: boolean;
  topic: string | null;
}

export interface VaultEvaluation {
  totalNotes: number;
  totalWords: number;
  totalFlashcards: number;
  totalAudioNotes: number;
  totalPdfNotes: number;
  untagged: NoteSnapshot[];
  orphaned: NoteSnapshot[];
  shortNotes: NoteSnapshot[];
  notesWithoutFlashcards: NoteSnapshot[];
  topics: Array<{ name: string; count: number; notes: string[] }>;
  gaps: Array<{ topic: string; reason: string; priority: number }>;
  subjects: Array<{ name: string; noteCount: number; wordCount: number; flashcards: number }>;
  averageQuality: number;
  evaluatedAt: number;
}

// Extensiones de audio comunes
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm", ".opus", ".aac"];

export class VaultEvaluator {
  /** Construye snapshots de las notas. */
  async buildSnapshots(
    files: TFile[],
    readContent: (f: TFile) => Promise<string>,
    metadata: (f: TFile) => Record<string, unknown> | null,
  ): Promise<NoteSnapshot[]> {
    const start = Date.now();
    log.info("Building snapshots", { fileCount: files.length, operation: "vault.snapshots" });

    const snapshots: NoteSnapshot[] = [];
    let audioCount = 0;
    let pdfCount = 0;
    let flashcardCount = 0;

    for (const f of files) {
      try {
        // v0.28 FIX: leer contenido async y procesar tags/links/wordCount.
        // En modo lazy (no se quiere await), se omite pero se mantienen heurísticas
        // basadas en path y frontmatter.
        const content = readContent ? await readContent(f) : "";
        const fm = metadata(f) ?? {};
        const tags = this.extractTags(content, fm);
        const links = this.extractLinks(content);

        const hasAudio = f.path.includes("Audio/") || AUDIO_EXTENSIONS.some((ext) => f.path.toLowerCase().endsWith(ext));
        const hasPdf = f.path.toLowerCase().endsWith(".pdf");
        // BUG FIX: hasFlashcards debe basarse en frontmatter (no en content lazy)
        const hasFlashcards = fm.type === "flashcard" || (fm.cards as unknown[] | undefined)?.length! > 0;

        if (hasAudio) audioCount++;
        if (hasPdf) pdfCount++;
        if (hasFlashcards) flashcardCount++;

        snapshots.push({
          path: f.path,
          basename: f.basename,
          content,
          size: content.length,
          modifiedAt: f.stat?.mtime ?? 0,
          frontmatter: fm,
          tags,
          links,
          wordCount: this.countWords(content),
          hasAudio,
          hasPdf,
          hasFlashcards,
          topic: (fm.subject as string) ?? (fm.topic as string) ?? null,
        });
      } catch (err) {
        log.error("Failed to build snapshot for file", { operation: "vault.snapshots", error: err, data: { path: f.path } });
      }
    }

    const durationMs = Date.now() - start;
    log.metric("vault_snapshots_duration_ms", durationMs);
    log.info("Snapshots built", { operation: "vault.snapshots", data: { count: snapshots.length, audio: audioCount, pdf: pdfCount, flashcards: flashcardCount, durationMs } });

    // Sanity checks: detectar anomalías
    if (snapshots.length === 0 && files.length > 0) {
      log.error("Zero snapshots from non-empty file list — possible bug", { operation: "vault.snapshots" });
    }
    if (audioCount > snapshots.length) {
      log.error("Audio count exceeds total snapshots — impossible state", { operation: "vault.snapshots" });
    }

    return snapshots;
  }

  /** Evalúa el vault. */
  evaluate(snapshots: NoteSnapshot[]): VaultEvaluation {
    const start = Date.now();

    // BUG FIX: validar inputs PRIMERO antes de acceder a propiedades
    if (!Array.isArray(snapshots)) {
      log.error("snapshots is not an array", { operation: "vault.eval", error: new TypeError("snapshots must be an array") });
      throw new TypeError("snapshots must be an array");
    }

    log.info("Starting evaluation", { operation: "vault.eval", data: { snapshotCount: snapshots.length } });

    const now = Date.now();
    const untagged: NoteSnapshot[] = [];
    const orphaned: NoteSnapshot[] = [];
    const shortNotes: NoteSnapshot[] = [];
    const notesWithoutFlashcards: NoteSnapshot[] = [];

    let totalWords = 0;
    let totalFlashcards = 0;
    let totalAudio = 0;
    let totalPdf = 0;
    let totalQuality = 0;

    const topicsMap = new Map<string, { count: number; notes: string[] }>();
    const subjectsMap = new Map<string, { noteCount: number; wordCount: number; flashcards: number }>();

    let iterationErrors = 0;

    for (const note of snapshots) {
      try {
        // wordCount: contar palabras reales
        const words = this.countWords(note.content);
        note.wordCount = words;
        totalWords += words;

        if (note.hasAudio) totalAudio++;
        if (note.hasPdf) totalPdf++;

        if (note.tags.length === 0) untagged.push(note);
        if (note.links.length === 0) orphaned.push(note);
        if (words < 100) shortNotes.push(note);
        if (!note.hasFlashcards && words > 50) notesWithoutFlashcards.push(note);

        const fcCount = (note.content.match(/## Card /g) ?? []).length;
        totalFlashcards += fcCount;
        note.frontmatter = note.frontmatter ?? {};

        // BUG FIX: topic consistente con subject — usar mismo fallback
        const topic = note.topic ?? note.tags[0] ?? "general";
        const t = topicsMap.get(topic) ?? { count: 0, notes: [] };
        t.count++;
        t.notes.push(note.path);
        topicsMap.set(topic, t);

        // BUG FIX: subject ahora también usa tags como fallback
        const subj = note.topic ?? note.tags[0] ?? "general";
        if (subj !== topic) {
          log.anomaly("subject_topic_mismatch", 1, 0, 0, {
            operation: "vault.eval",
            data: { path: note.path, topic, subject: subj },
          });
        }
        const s = subjectsMap.get(subj) ?? { noteCount: 0, wordCount: 0, flashcards: 0 };
        s.noteCount++;
        s.wordCount += words;
        s.flashcards += fcCount;
        subjectsMap.set(subj, s);

        // Quality score
        let quality = 0;
        quality += Math.min(1, words / 500);
        quality += note.tags.length > 0 ? 0.2 : 0;
        quality += note.links.length > 0 ? 0.2 : 0;
        quality += fcCount > 0 ? 0.3 : 0;
        quality = Math.min(1, quality);
        totalQuality += quality;
      } catch (err) {
        iterationErrors++;
        log.error("Failed to evaluate note", { operation: "vault.eval", error: err, data: { path: note.path } });
      }
    }

    if (iterationErrors > 0) {
      log.warn("Some notes failed to evaluate", { operation: "vault.eval", data: { errorCount: iterationErrors, total: snapshots.length } });
    }

    // Gaps
    const gaps: Array<{ topic: string; reason: string; priority: number }> = [];
    for (const [topic, info] of topicsMap.entries()) {
      if (info.count === 1) {
        gaps.push({ topic, reason: "Solo 1 nota sobre este tema", priority: 0.8 });
      }
    }
    for (const [subject, info] of subjectsMap.entries()) {
      if (info.noteCount > 0 && info.flashcards === 0) {
        gaps.push({ topic: subject, reason: `Subject "${subject}" sin flashcards`, priority: 0.7 });
      }
      if (info.noteCount > 2 && info.wordCount / info.noteCount < 200) {
        gaps.push({ topic: subject, reason: `Notas de "${subject}" muy cortas`, priority: 0.5 });
      }
    }

    const averageQuality = snapshots.length > 0 ? totalQuality / snapshots.length : 0;

    const result: VaultEvaluation = {
      totalNotes: snapshots.length,
      totalWords,
      totalFlashcards,
      totalAudioNotes: totalAudio,
      totalPdfNotes: totalPdf,
      untagged,
      orphaned,
      shortNotes,
      notesWithoutFlashcards,
      topics: Array.from(topicsMap.entries()).map(([name, v]) => ({ name, count: v.count, notes: v.notes })),
      gaps: gaps.sort((a, b) => b.priority - a.priority),
      subjects: Array.from(subjectsMap.entries()).map(([name, v]) => ({ name, ...v })),
      averageQuality,
      evaluatedAt: now,
    };

    // Sanity checks
    log.assert(snapshots.length === result.totalNotes, "totalNotes mismatch", { operation: "vault.eval" });
    log.assert(totalAudio === result.totalAudioNotes, "totalAudioNotes mismatch", { operation: "vault.eval" });
    log.assert(result.averageQuality >= 0 && result.averageQuality <= 1, `averageQuality fuera de rango: ${result.averageQuality}`, { operation: "vault.eval" });
    log.assertRange(result.averageQuality, 0, 1, "averageQuality", { operation: "vault.eval" });

    // Detección de anomalías estadísticas
    if (snapshots.length > 0) {
      const untaggedPct = untagged.length / snapshots.length;
      if (untaggedPct > 0.9) {
        log.warn("Más del 90% de notas sin tags — posible problema de parsing", {
          operation: "vault.eval",
          data: { untaggedCount: untagged.length, total: snapshots.length, pct: untaggedPct },
        });
      }
      if (result.totalFlashcards === 0 && snapshots.length > 5) {
        log.warn("Vault con >5 notas pero 0 flashcards detectadas", { operation: "vault.eval", data: { total: snapshots.length } });
      }
    }

    const durationMs = Date.now() - start;
    log.metric("vault_eval_duration_ms", durationMs);
    log.info("Evaluation complete", {
      operation: "vault.eval",
      data: {
        durationMs,
        totalNotes: result.totalNotes,
        totalWords: result.totalWords,
        gaps: result.gaps.length,
        averageQuality: result.averageQuality.toFixed(2),
      },
    });

    return result;
  }

  /** Cuenta palabras con NFD + acentos. */
  private countWords(content: string): number {
    if (!content) return 0;
    const tokens = content.split(/\s+/).filter((w) => w.length > 0);
    return tokens.length;
  }

  private extractTags(content: string, fm: Record<string, unknown>): string[] {
    const tags = new Set<string>();
    try {
      if (Array.isArray(fm.tags)) {
        for (const t of fm.tags) {
          if (t != null) tags.add(String(t));
        }
      }
      if (content) {
        const inlineTags = content.match(/(?:^|\s)#[\wáéíóúüñ-]+/gi) ?? [];
        for (const m of inlineTags) {
          const t = m.trim().replace(/^#/, "");
          if (t) tags.add(t);
        }
      }
    } catch (err) {
      log.error("Failed to extract tags", { operation: "vault.tags", error: err });
    }
    return Array.from(tags);
  }

  private extractLinks(content: string): string[] {
    const links: string[] = [];
    try {
      if (!content) return links;
      const m1 = content.match(/\[\[([^\]]+)\]\]/g) ?? [];
      for (const m of m1) {
        const link = m.slice(2, -2).split("|")[0];
        if (link) links.push(link);
      }
    } catch (err) {
      log.error("Failed to extract links", { operation: "vault.links", error: err });
    }
    return links;
  }
}
