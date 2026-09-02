// v0.25: Sistema de relevancia cruzada.
// Conecta notas, audios de clase, y PDFs/libros del temario.
// Detecta qué información se repite entre fuentes y la enlaza.

export interface NoteDocument {
  id: string;
  path: string;
  title: string;
  content: string;
  type: "note" | "audio-transcript" | "pdf-page" | "flashcard-deck";
  source: {
    type: "obsidian" | "audio-recording" | "pdf-file" | "manual";
    ref?: string; // path, file, etc
    audioPath?: string;
    audioStartMs?: number;
    audioEndMs?: number;
    pdfPath?: string;
    pdfPage?: number;
  };
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface CrossMatch {
  sourceA: NoteDocument;
  sourceB: NoteDocument;
  /** Similitud coseno entre embeddings. */
  similarity: number;
  /** Frases que se repiten (overlap textual). */
  sharedPhrases: string[];
  /** Tipo de relación detectada. */
  relation: "duplicate" | "extension" | "complement" | "contradiction" | "reference";
  /** Recomendación al usuario. */
  recommendation: string;
  /** Confianza en la detección 0..1. */
  confidence: number;
}

export interface FactCheckIssue {
  /** Documento donde se encontró el problema. */
  documentId: string;
  documentPath: string;
  /** Frase sospechosa. */
  claim: string;
  /** Razón de la sospecha. */
  issue: "factually_incorrect" | "outdated" | "unverifiable" | "contradicts_source";
  /** Documento(s) de referencia que lo contradicen. */
  contradictingSources: NoteDocument[];
  /** Sugerencia de corrección. */
  suggestedFix?: string;
  /** Severidad. */
  severity: "low" | "medium" | "high";
  confidence: number;
}

export interface CrossRelevanceOptions {
  /** Similitud mínima para considerar match. */
  minSimilarity: number;
  /** Máximo de matches a devolver. */
  maxMatches: number;
  /** Si debe detectar contradicciones (info incorrecta). */
  detectContradictions: boolean;
  /** Si debe fact-check contra fuentes. */
  factCheck: boolean;
}

const DEFAULT_OPTIONS: CrossRelevanceOptions = {
  minSimilarity: 0.5,
  maxMatches: 50,
  detectContradictions: true,
  factCheck: true,
};

/** Tokeniza texto en palabras (incluye acentos y ñ). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar diacríticos para matching
    .split(/[^a-z0-9áéíóúüñ]+/i)
    .filter((w) => w.length > 3);
}

/** Función simple de similitud textual (Jaccard sobre palabras). */
function textSimilarity(a: string, b: string): number {
  const wa = new Set(tokenize(a));
  const wb = new Set(tokenize(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return inter / union;
}

/** Encuentra frases compartidas (n-gramas de 3+ palabras). */
function findSharedPhrases(a: string, b: string): string[] {
  const phrases: string[] = [];
  const wordsA = a.split(/\s+/);
  const bLower = b.toLowerCase();
  for (let i = 0; i < wordsA.length - 2; i++) {
    const phrase = wordsA.slice(i, i + 3).join(" ").toLowerCase();
    if (phrase.replace(/\s/g, "").length < 10) continue;
    if (bLower.includes(phrase)) {
      phrases.push(phrase);
    }
  }
  return Array.from(new Set(phrases));
}

/** Detecta contradicciones (palabras antagónicas en frases similares). */
const ANTAGONIST_PAIRS: [string, string][] = [
  ["aumenta", "disminuye"],
  ["mayor", "menor"],
  ["siempre", "nunca"],
  ["positivo", "negativo"],
  ["estimula", "inhibe"],
  ["incrementa", "reduce"],
];

function detectContradiction(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  for (const [p, q] of ANTAGONIST_PAIRS) {
    if ((la.includes(p) && lb.includes(q)) || (la.includes(q) && lb.includes(p))) {
      // Verificar que estén en contexto similar
      const idxA = la.indexOf(p) === -1 ? la.indexOf(q) : la.indexOf(p);
      const idxB = lb.indexOf(p) === -1 ? lb.indexOf(q) : lb.indexOf(p);
      const contextA = la.substring(Math.max(0, idxA - 30), idxA + 30);
      const contextB = lb.substring(Math.max(0, idxB - 30), idxB + 30);
      if (textSimilarity(contextA, contextB) > 0.3) return true;
    }
  }
  return false;
}

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
