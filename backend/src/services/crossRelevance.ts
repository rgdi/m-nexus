// Cross-relevance: main analyzer.

import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
import type {
  NoteDocument,
  CrossMatch,
  FactCheckIssue,
  CrossRelevanceOptions,
} from "./crossRelevanceTypes.js";
import {
  DEFAULT_OPTIONS,
  textSimilarity,
  findSharedPhrases,
  detectContradiction,
} from "./crossRelevanceTypes.js";

// v0.25: Sistema de relevancia cruzada.
// Conecta notas, audios de clase, y PDFs/libros del temario.
// Detecta qué información se repite entre fuentes y la enlaza.

export class CrossRelevanceAnalyzer {
  private options: CrossRelevanceOptions;

  constructor(options: Partial<CrossRelevanceOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Encuentra matches entre un documento y una colección.
   * Combina Jaccard con bonus por frases compartidas.
   */
  findMatches(target: NoteDocument, corpus: NoteDocument[]): CrossMatch[] {
    const matches: CrossMatch[] = [];
    for (const doc of corpus) {
      if (doc.id === target.id) continue;
      const baseSim = textSimilarity(target.content, doc.content);
      const sharedPhrases = findSharedPhrases(target.content, doc.content);
      // Boost: cada frase compartida añade 0.1 al score (cap 0.3)
      const boost = Math.min(0.3, sharedPhrases.length * 0.1);
      const sim = Math.min(1, baseSim + boost);
      if (sim < this.options.minSimilarity) continue;
      const contradiction = this.options.detectContradictions && detectContradiction(target.content, doc.content);
      matches.push({
        sourceA: target,
        sourceB: doc,
        similarity: sim,
        sharedPhrases,
        relation: contradiction ? "contradiction" : sim > 0.85 ? "duplicate" : sim > 0.75 ? "extension" : "complement",
        recommendation: this.recommend(contradiction, sim, target, doc),
        confidence: Math.min(1, sim + sharedPhrases.length * 0.05),
      });
    }
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, this.options.maxMatches);
  }

  /**
   * Encuentra todas las relaciones en un corpus (matriz NxN).
   */
  findAllRelations(corpus: NoteDocument[]): CrossMatch[] {
    const all: CrossMatch[] = [];
    for (let i = 0; i < corpus.length; i++) {
      const matches = this.findMatches(corpus[i], corpus);
      // Evitar duplicados
      for (const m of matches) {
        if (!all.some((x) => (x.sourceA.id === m.sourceA.id && x.sourceB.id === m.sourceB.id))) {
          all.push(m);
        }
      }
    }
    return all;
  }

  /**
   * Detecta posibles problemas de información incorrecta.
   * Compara las notas contra fuentes "autorizadas" (PDFs del temario, transcripciones de clase).
   */
  factCheck(target: NoteDocument, trustedSources: NoteDocument[]): FactCheckIssue[] {
    const issues: FactCheckIssue[] = [];
    if (!this.options.factCheck) return issues;

    for (const source of trustedSources) {
      if (source.id === target.id) continue;
      // 1) Detectar contradicciones directas
      const directContradiction = detectContradiction(target.content, source.content);
      if (directContradiction) {
        issues.push({
          documentId: target.id,
          documentPath: target.path,
          claim: "(contradicción detectada entre documentos completos)",
          issue: "contradicts_source",
          contradictingSources: [source],
          suggestedFix: this.suggestFix("", source),
          severity: "high",
          confidence: 0.8,
        });
      }
      // 2) Buscar claims específicos en el target
      const claims = this.extractClaims(target.content);
      for (const claim of claims) {
        const inSource = source.content.toLowerCase().includes(claim.toLowerCase());
        if (!inSource) {
          // Buscar si hay una versión contradictoria en la fuente
          if (detectContradiction(claim, source.content)) {
            issues.push({
              documentId: target.id,
              documentPath: target.path,
              claim,
              issue: "contradicts_source",
              contradictingSources: [source],
              suggestedFix: this.suggestFix(claim, source),
              severity: "high",
              confidence: 0.75,
            });
          } else {
            // Buscar claim similar que difiera
            const similarClaim = this.findSimilarClaim(claim, source.content);
            if (similarClaim && similarClaim.similarity > 0.7 && similarClaim.different) {
              issues.push({
                documentId: target.id,
                documentPath: target.path,
                claim,
                issue: "contradicts_source",
                contradictingSources: [source],
                severity: "medium",
                confidence: 0.65,
              });
            }
          }
        }
      }
    }
    return issues;
  }

  /**
   * Auto-referencia: dado un documento y un corpus,
   * devuelve las menciones que se pueden auto-enlazar.
   */
  findAutoReferences(target: NoteDocument, corpus: NoteDocument[]): Array<{
    phrase: string;
    matchedDoc: NoteDocument;
    matchedPhrase: string;
    confidence: number;
  }> {
    const refs: Array<{ phrase: string; matchedDoc: NoteDocument; matchedPhrase: string; confidence: number }> = [];
    // Extraer frases candidatas del target (definiciones, hechos)
    const candidates = this.extractClaims(target.content);
    for (const c of candidates) {
      for (const doc of corpus) {
        if (doc.id === target.id) continue;
        const matched = this.findSimilarClaim(c, doc.content);
        if (matched && matched.similarity > 0.6) {
          refs.push({
            phrase: c,
            matchedDoc: doc,
            matchedPhrase: matched.text,
            confidence: matched.similarity,
          });
        }
      }
    }
    // Ordenar por confianza
    return refs.sort((a, b) => b.confidence - a.confidence);
  }

  private extractClaims(text: string): string[] {
    const claims: string[] = [];
    // Frases que parecen afirmaciones: empiezan con mayúscula, terminan en punto, contienen verbo
    const sentences = text.split(/[.!?]\s+/);
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 300) continue;
      // Heurística: contiene verbo típico
      if (/\b(es|son|está|son|se|produce|genera|causa|existe|tiene|contiene|libera|transporta|regula|controla)\b/i.test(trimmed)) {
        claims.push(trimmed);
      }
    }
    return claims;
  }

  private findSimilarClaim(claim: string, content: string): { text: string; similarity: number; different: boolean } | null {
    const sentences = content.split(/[.!?]\s+/);
    let best = { text: "", similarity: 0, different: false };
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length < 20) continue;
      const sim = textSimilarity(claim, trimmed);
      if (sim > best.similarity) {
        best = { text: trimmed, similarity: sim, different: trimmed.toLowerCase() !== claim.toLowerCase() };
      }
    }
    return best.similarity > 0.3 ? best : null;
  }

  private recommend(contradiction: boolean, sim: number, a: NoteDocument, b: NoteDocument): string {
    if (contradiction) {
      return `⚠️ Posible contradicción entre "${a.title}" y "${b.title}". Verifica la información.`;
    }
    if (sim > 0.85) {
      return `📋 Contenido casi duplicado. Considera fusionar o enlazar.`;
    }
    if (sim > 0.75) {
      return `🔗 "${b.title}" extiende "${a.title}". Considera enlazar como referencia.`;
    }
    return `💡 Información complementaria. Considera enlazar para cross-reference.`;
  }

  private suggestFix(claim: string, source: NoteDocument): string {
    return `Compara con: "${source.title}" (${source.path})`;
  }
}
