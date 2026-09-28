// services/grading.ts — AI-graded answer evaluation (v2.36.0).
//
// Two graders, both deterministic-first with an LLM fallback:
//
//   1. gradeTypedAnswer(userAnswer, expected, context?)
//      Closed short-answer. Normalises (case, accents, punctuation,
//      articles, whitespace), then scores:
//        - exact match        → 100
//        - normalised match   → 100
//        - token F1           → 0..100
//        - LLM semantic grade → 0..100 (only when the token score is
//                                ambiguous, i.e. 0.35 < f1 < 0.85)
//
//   2. gradeMultipleChoice(choices, correctIndex, explanation?)
//      Server-side re-grade so a tampered client cannot claim credit.
//      Returns the index plus a per-choice breakdown for the UI.
//
// The LLM path is optional: if no provider is reachable the grader
// degrades to the deterministic score and says so in `gradedBy`, so
// the UI can show "revisado por IA" only when it actually was.

import { LLMService } from "./llm.js";

const STOPWORDS_ES = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "a", "en", "con", "por", "para", "y", "e",
  "o", "u", "the", "a", "an", "of", "in", "on", "to", "for", "and",
]);

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalise(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenise(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS_ES.has(t));
}

export interface TokenScore {
  score: number;          // 0..1
  matched: string[];
  missed: string[];
  extra: string[];
}

export function tokenF1(user: string, expected: string): TokenScore {
  const u = tokenise(user);
  const e = tokenise(expected);
  if (e.length === 0) return { score: 1, matched: [], missed: [], extra: u };
  if (u.length === 0) return { score: 0, matched: [], missed: e, extra: [] };

  const pool = [...e];
  const matched: string[] = [];
  for (const t of u) {
    const i = pool.indexOf(t);
    if (i >= 0) {
      matched.push(t);
      pool.splice(i, 1);
    }
  }
  const extra = u.filter((t) => !matched.includes(t));
  const missed = pool;

  const precision = matched.length / u.length;
  const recall = matched.length / e.length;
  const score = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { score, matched, missed, extra };
}

export interface TypedGrade {
  score: number;              // 0..100
  verdict: "correct" | "partial" | "incorrect";
  gradedBy: "exact" | "normalized" | "tokens" | "llm" | "llm-failed";
  feedback: string;
  matched: string[];
  missed: string[];
  extra: string[];
  correctAnswer: string;
}

const VERDICT_CUT = 80;

/**
 * gradeTypedAnswer — score a free-text answer against the expected one.
 * @param userAnswer  what the learner typed
 * @param expected    the canonical answer (card.back)
 * @param context     optional surrounding text, given to the LLM
 * @param opts.useLlm  set false to force the deterministic path
 */
export async function gradeTypedAnswer(
  userAnswer: string,
  expected: string,
  context?: string,
  opts: { useLlm?: boolean } = {},
): Promise<TypedGrade> {
  const useLlm = opts.useLlm !== false;
  const user = String(userAnswer ?? "").trim();
  const exp = String(expected ?? "").trim();

  if (!user) {
    return {
      score: 0, verdict: "incorrect", gradedBy: "exact",
      feedback: "No has escrito nada.", matched: [], missed: tokenise(exp), extra: [],
      correctAnswer: exp,
    };
  }

  // 1. Exact.
  if (user === exp) {
    return {
      score: 100, verdict: "correct", gradedBy: "exact",
      feedback: "¡Exacto!", matched: tokenise(exp), missed: [], extra: [],
      correctAnswer: exp,
    };
  }

  // 2. Normalised.
  if (normalise(user) === normalise(exp)) {
    return {
      score: 100, verdict: "correct", gradedBy: "normalized",
      feedback: "Correcto (difiere solo en tildes o puntuación).",
      matched: tokenise(exp), missed: [], extra: [],
      correctAnswer: exp,
    };
  }

  // 3. Token F1.
  const f1 = tokenF1(user, exp);
  const pct = Math.round(f1.score * 100);

  if (f1.score >= 0.85) {
    return {
      score: pct, verdict: "correct", gradedBy: "tokens",
      feedback: f1.extra.length
        ? `Correcto. Sobraron: ${f1.extra.join(", ")}.`
        : "¡Correcto!",
      matched: f1.matched, missed: f1.missed, extra: f1.extra,
      correctAnswer: exp,
    };
  }

  // 4. LLM for the ambiguous middle band.
  const ambiguous = f1.score > 0.2 && f1.score < 0.85;
  if (useLlm && ambiguous) {
    try {
      const llm = new LLMService();
      const available = (await llm.ollamaAvailable()) || (await llm.openrouterAvailable());
      if (available) {
        const prompt = [
          "Eres un corrector de respuestas de examen.",
          "Compara la RESPUESTA DEL ALUMNO con la RESPUESTA CORRECTA.",
          'Responde SOLO con un JSON: {"score": 0-100, "feedback": "una frase corta en español"}',
          "",
          context ? `CONTEXTO:\n${context.slice(0, 2000)}` : "",
          "",
          `RESPUESTA CORRECTA:\n${exp}`,
          "",
          `RESPUESTA DEL ALUMNO:\n${user}`,
        ].filter(Boolean).join("\n");

        const resp = await llm.chat({
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          maxTokens: 200,
          responseFormat: "json",
        });
        const parsed = parseScoreJson(resp.content);
        if (parsed) {
          return {
            score: Math.max(0, Math.min(100, parsed.score)),
            verdict: parsed.score >= VERDICT_CUT ? "correct"
              : parsed.score >= 50 ? "partial" : "incorrect",
            gradedBy: "llm",
            feedback: parsed.feedback,
            matched: f1.matched, missed: f1.missed, extra: f1.extra,
            correctAnswer: exp,
          };
        }
      }
    } catch {
      // fall through to the deterministic result
    }
  }

  // 5. Deterministic verdict.
  return {
    score: pct,
    verdict: pct >= VERDICT_CUT ? "correct" : pct >= 45 ? "partial" : "incorrect",
    gradedBy: "tokens",
    feedback: buildDeterministicFeedback(f1, exp),
    matched: f1.matched, missed: f1.missed, extra: f1.extra,
    correctAnswer: exp,
  };
}

function buildDeterministicFeedback(f1: TokenScore, expected: string): string {
  if (f1.missed.length && f1.extra.length) {
    return `Faltó: ${f1.missed.join(", ")}. Sobró: ${f1.extra.join(", ")}.`;
  }
  if (f1.missed.length) {
    return `Casi. Falta: ${f1.missed.join(", ")}.`;
  }
  if (f1.extra.length) {
    return `Correcto, pero con palabras de más: ${f1.extra.join(", ")}.`;
  }
  return `La respuesta correcta era: ${expected}`;
}

function parseScoreJson(raw: string): { score: number; feedback: string } | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const score = Number(o.score);
    if (!Number.isFinite(score)) return null;
    return { score, feedback: String(o.feedback ?? "").slice(0, 300) };
  } catch {
    return null;
  }
}

export interface McqGrade {
  correctIndex: number;
  chosenIndex: number;
  correct: boolean;
  explanation: string;
  /** Per-choice verdict, aligned with card.options. */
  perChoice: Array<{ text: string; correct: boolean; chosen: boolean }>;
}

/**
 * gradeMultipleChoice — authoritative check performed server-side.
 * The client sends what the learner picked; the server decides.
 */
export function gradeMultipleChoice(
  options: string[],
  correctIndex: number,
  chosenIndex: number,
  explanation = "",
): McqGrade {
  const safeCorrect = Number.isInteger(correctIndex) && correctIndex >= 0 && correctIndex < options.length
    ? correctIndex
    : 0;
  const safeChosen = Number.isInteger(chosenIndex) && chosenIndex >= 0 && chosenIndex < options.length
    ? chosenIndex
    : -1;
  return {
    correctIndex: safeCorrect,
    chosenIndex: safeChosen,
    correct: safeChosen === safeCorrect,
    explanation,
    perChoice: options.map((text, i) => ({
      text,
      correct: i === safeCorrect,
      chosen: i === safeChosen,
    })),
  };
}
