// typeAnswerService.ts: type-answer cards con fuzzy matching (Fase 3.C).
//
// v0.46: validación inteligente de respuestas tipeadas estilo Anki.
// Acepta múltiples respuestas válidas separadas por | y aplica
// comparación fuzzy (Levenshtein) para typos menores.

export interface TypeAnswerCard {
  question: string;
  /** Respuestas válidas (separadas por | en el front matter) */
  answers: string[];
  /** Ignorar case en comparación */
  caseSensitive: boolean;
  /** Distancia máxima de Levenshtein para aceptar como "casi correcta" */
  fuzzyThreshold: number;
  /** Ignorar espacios extras */
  trimWhitespace: boolean;
}

export interface AnswerEvaluation {
  /** La respuesta del usuario */
  userAnswer: string;
  /** ¿Es correcta? */
  correct: boolean;
  /** ¿Es "casi correcta" (fuzzy match)? */
  almost: boolean;
  /** Match distance (Levenshtein) — 0 = exacto */
  distance: number;
  /** Matched canonical answer (la respuesta correcta matched) */
  matchedAnswer: string | null;
  /** Score 0-1: 1.0 = exacto, 0.0 = muy diferente */
  score: number;
}

/**
 * Distancia de Levenshtein entre dos strings.
 * Algoritmo Wagner-Fischer con space optimization.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Optimization: usar dos rows en vez de matriz completa
  let prev: number[] = Array(b.length + 1).fill(0).map((_, i) => i);
  let curr: number[] = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export class TypeAnswerService {
  /**
   * Parsea una card desde front matter.
   * Formato:
   *   type_answer:
   *     question: ¿Cuál es la capital de Francia?
   *     answers: ["París", "Paris"]
   *     caseSensitive: false
   *     fuzzyThreshold: 2
   *     trimWhitespace: true
   */
  static parseFromFrontmatter(content: string): TypeAnswerCard | null {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1];
    if (!/^type_answer:/m.test(fm)) return null;

    const questionMatch = fm.match(/^\s+question:\s*['"]?(.+?)['"]?\s*$/m);
    if (!questionMatch) return null;
    const question = questionMatch[1];

    // answers: [a, b, c] o answers: a, b, c
    const answers: string[] = [];
    const arrMatch = fm.match(/^\s+answers:\s*\[(.*?)\]/m);
    if (arrMatch) {
      arrMatch[1].split(",").forEach((a) => {
        const t = a.trim().replace(/^['"]|['"]$/g, "");
        if (t) answers.push(t);
      });
    } else {
      const inlineMatch = fm.match(/^\s+answers:\s*(.+)$/m);
      if (inlineMatch) {
        inlineMatch[1].split(",").forEach((a) => {
          const t = a.trim().replace(/^['"]|['"]$/g, "");
          if (t) answers.push(t);
        });
      }
    }
    if (answers.length === 0) return null;

    const caseSensitive = /^\s+caseSensitive:\s*true/m.test(fm);
    const fuzzyMatch = fm.match(/^\s+fuzzyThreshold:\s*(\d+)/m);
    const fuzzyThreshold = fuzzyMatch ? parseInt(fuzzyMatch[1], 10) : 2;
    const trimWhitespace = !/^\s+trimWhitespace:\s*false/m.test(fm);

    return {
      question,
      answers,
      caseSensitive,
      fuzzyThreshold,
      trimWhitespace,
    };
  }

  /**
   * Evalúa la respuesta del usuario.
   */
  static evaluate(card: TypeAnswerCard, userAnswer: string): AnswerEvaluation {
    let normalizedUser = userAnswer;
    if (card.trimWhitespace) {
      normalizedUser = normalizedUser.trim().replace(/\s+/g, " ");
    }
    if (!card.caseSensitive) {
      normalizedUser = normalizedUser.toLowerCase();
    }

    let bestMatch: { answer: string; distance: number } | null = null;
    for (const answer of card.answers) {
      let normalizedAnswer = answer;
      if (card.trimWhitespace) {
        normalizedAnswer = normalizedAnswer.trim().replace(/\s+/g, " ");
      }
      if (!card.caseSensitive) {
        normalizedAnswer = normalizedAnswer.toLowerCase();
      }
      const distance = levenshtein(normalizedUser, normalizedAnswer);
      if (bestMatch === null || distance < bestMatch.distance) {
        bestMatch = { answer, distance };
      }
    }

    if (bestMatch === null) {
      return {
        userAnswer,
        correct: false,
        almost: false,
        distance: Infinity,
        matchedAnswer: null,
        score: 0,
      };
    }

    const correct = bestMatch.distance === 0;
    const almost = !correct && bestMatch.distance <= card.fuzzyThreshold;
    const maxLen = Math.max(normalizedUser.length, bestMatch.answer.length);
    const score = maxLen === 0 ? 1 : 1 - bestMatch.distance / maxLen;

    return {
      userAnswer,
      correct,
      almost,
      distance: bestMatch.distance,
      matchedAnswer: bestMatch.answer,
      score,
    };
  }
}
