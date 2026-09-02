// Auditor de cobertura (Fase 3).
// Compara la nota del estudiante con la transcripción de audio y/o un PDF de temario.
// Devuelve huecos potenciales que el estudiante debe decidir si añadir.

import { App, TFile } from "obsidian";
import { CoverageGap, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";
import { FrontmatterManager } from "../metadata/frontmatter";
import { EMPHASIS_PATTERNS } from "../constants";

export interface AuditSource {
  /** Texto plano del temario o transcripción contra el que auditar. */
  referenceText: string;
  sourceLabel: "transcript" | "pdf" | "manual";
}

export class CoverageAuditor {
  private fm: FrontmatterManager;

  constructor(private app: App, private settings: MNexusSettings, private log: Logger) {
    this.fm = new FrontmatterManager(app);
  }

  /**
   * Calcula un score 0–100 indicando cuánto del temario está reflejado en la nota.
   * Heurística: extrae frases "importantes" (énfasis) y términos en mayúsculas
   * largas del texto de referencia; comprueba cuántas aparecen en la nota.
   */
  async auditNote(note: TFile, source: AuditSource): Promise<{ score: number; gaps: CoverageGap[] }> {
    if (!this.settings.enableCoverageAudit) return { score: 100, gaps: [] };

    const noteContent = (await this.app.vault.read(note)).toLowerCase();
    const referenceText = source.referenceText;
    const reference = referenceText.toLowerCase();

    const keywords = this.extractKeywords(reference);
    if (keywords.length === 0) return { score: 100, gaps: [] };

    const present = keywords.filter((k) => noteContent.includes(k));
    const missing = keywords.filter((k) => !noteContent.includes(k));

    const score = Math.round((present.length / keywords.length) * 100);
    const gaps: CoverageGap[] = missing.map((term, idx) => ({
      id: `${note.path}#gap-${idx}-${Date.now()}`,
      notePath: note.path,
      topic: term,
      evidence: this.findContextFor(referenceText, term),
      source: source.sourceLabel,
      severity: "minor",
      resolved: false,
    }));

    // Huegos críticos = frases de énfasis completas no reflejadas
    for (const pat of EMPHASIS_PATTERNS) {
      const m = referenceText.match(pat);
      if (m && !noteContent.includes(m[0].toLowerCase())) {
        gaps.push({
          id: `${note.path}#critical-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          notePath: note.path,
          topic: "Énfasis del profesor",
          evidence: m[0],
          source: source.sourceLabel,
          severity: "critical",
          resolved: false,
        });
      }
    }

    await this.fm.merge(note, {
      coverage_score: score,
      last_audit: new Date().toISOString(),
    });
    this.log.info(`Auditoría ${note.basename}: ${score}% (${gaps.length} huecos)`);
    return { score, gaps };
  }

  private extractKeywords(text: string): string[] {
    // Frases de énfasis
    const emph: string[] = [];
    for (const pat of EMPHASIS_PATTERNS) {
      const m = text.match(pat);
      if (m) emph.push(m[0]);
    }
    // Términos médicos: palabras largas en mayúsculas o CamelCase, o frases nominales simples
    const terms = new Set<string>();
    const re = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}(?:\s+[a-záéíóúñ]{3,}){0,3})\b/g;
    for (const m of text.matchAll(re)) {
      const t = m[1].trim();
      if (t.length > 6) terms.add(t);
    }
    // Acrónimos médicos 2-5 letras (VPH, VIH, ACV, EPOC, IAM, COVID): críticos.
    // Solo si están todos en mayúsculas (e.g. "VPH" o "COVID-19").
    const acrRe = /\b([A-Z]{2,5}(?:[-–][A-Z0-9]+)?)\b/g;
    for (const m of text.matchAll(acrRe)) {
      terms.add(m[1]);
    }
    return Array.from(new Set([...emph, ...terms])).slice(0, 30);
  }

  private findContextFor(text: string, term: string): string {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx < 0) return term;
    const start = Math.max(0, idx - 60);
    const end = Math.min(text.length, idx + term.length + 60);
    return "…" + text.slice(start, end).replace(/\s+/g, " ").trim() + "…";
  }
}
