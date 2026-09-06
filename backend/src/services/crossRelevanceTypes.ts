// Cross-relevance: types & helper functions.

export interface NoteDocument {
  id: string;
  path: string;
  title: string;
  content: string;
  type: "note" | "audio-transcript" | "pdf-page" | "flashcard-deck";
  source: {
     type: "vault" | "audio-recording" | "pdf-file" | "manual";
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

