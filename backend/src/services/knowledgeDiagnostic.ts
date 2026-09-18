// knowledgeDiagnostic.ts — Pre-study calibration quiz for FSRS.
//
// v2.8.0 — Antes de empezar a estudiar un tema, el sistema ejecuta un
// "diagnóstico de conocimiento": 8-12 preguntas control sobre el temario
// para calibrar el parámetro initialDifficulty del FSRS.
//
// Output: un perfil por tema con {initialStability, initialDifficulty, retentionGoal}
// que se inyecta a las flashcards nuevas de ese tema.

import type { Card } from "ts-fsrs";

export interface DiagnosticQuestion {
  id: string;
  prompt: string;
  /** Multiple choice or free text */
  options?: string[];
  correct: string;
  concept: string;        // concept id this tests
  weight: number;         // 0-1, importance
}

export interface DiagnosticAnswer {
  questionId: string;
  answer: string;
  correct: boolean;
  timeMs: number;
}

export interface DiagnosticResult {
  topicId: string;
  totalQuestions: number;
  correctCount: number;
  /** 0-1, overall knowledge ratio */
  knowledgeRatio: number;
  /** 0-1, confidence calibration. Difference between correct + fast vs correct + slow */
  confidence: number;
  /** Per-concept breakdown */
  byConcept: Record<string, { correct: number; total: number; ratio: number }>;
  /** Recommended FSRS starting params */
  fsrsProfile: {
    initialStability: number;   // days
    initialDifficulty: number;  // 1-10
    desiredRetention: number;   // 0.7-0.95
  };
  takenAt: number;
}

const BASE_DIFFICULTY = 5.0;
const BASE_STABILITY = 1.0;
const BASE_RETENTION = 0.9;

/**
 * Convert raw answers + knowledgeRatio into FSRS starting parameters.
 *
 * Reasoning:
 * - knowledgeRatio 0% → fully new (default params)
 * - knowledgeRatio 50% → moderate (slightly easier difficulty, higher stability)
 * - knowledgeRatio 100% → very stable, low difficulty (user already knows it)
 *
 * Confidence (answer speed) shifts retention goal: fast + wrong = needs more review.
 */
export function computeProfile(
  topicId: string,
  questions: DiagnosticQuestion[],
  answers: DiagnosticAnswer[],
): DiagnosticResult {
  const byConcept: Record<string, { correct: number; total: number; ratio: number }> = {};
  let correctCount = 0;
  const totalMs = answers.reduce((s, a) => s + a.timeMs, 0);
  const avgMs = answers.length ? totalMs / answers.length : 5000;

  for (const q of questions) {
    const bucket = byConcept[q.concept] ||= { correct: 0, total: 0, ratio: 0 };
    bucket.total++;
  }
  for (const a of answers) {
    const q = questions.find((x) => x.id === a.questionId);
    if (!q) continue;
    if (a.correct) {
      correctCount++;
      byConcept[q.concept].correct++;
    }
  }
  for (const k of Object.keys(byConcept)) {
    const b = byConcept[k];
    b.ratio = b.total > 0 ? b.correct / b.total : 0;
  }

  const totalQuestions = questions.length;
  const knowledgeRatio = totalQuestions > 0 ? correctCount / totalQuestions : 0;

  // Confidence: penalize slow wrong answers (might be guessing) and reward fast correct
  let confSum = 0;
  for (const a of answers) {
    const speedFactor = Math.max(0, Math.min(1, 1 - a.timeMs / 15000));
    confSum += a.correct ? speedFactor : (1 - speedFactor) * 0.5;
  }
  const confidence = answers.length ? confSum / answers.length : 0.5;

  // Convert to FSRS params
  // knowledgeRatio 1.0 → difficulty 2.5, stability 14 days
  // knowledgeRatio 0.0 → difficulty 7, stability 0.5 days
  const initialDifficulty = BASE_DIFFICULTY - 4.5 * knowledgeRatio + (1 - confidence) * 1.5;
  const initialStability = BASE_STABILITY + 13 * knowledgeRatio * (0.5 + 0.5 * confidence);

  // Confidence in answers + knowledge level → retention goal
  const desiredRetention = Math.max(
    0.7,
    Math.min(0.95, BASE_RETENTION - 0.1 * (1 - confidence) - 0.05 * (1 - knowledgeRatio)),
  );

  return {
    topicId,
    totalQuestions,
    correctCount,
    knowledgeRatio,
    confidence,
    byConcept,
    fsrsProfile: {
      initialStability: round(initialStability, 2),
      initialDifficulty: clamp(round(initialDifficulty, 2), 1, 10),
      desiredRetention: round(desiredRetention, 2),
    },
    takenAt: Date.now(),
  };
}

export function applyProfileToCard(card: Card, profile: DiagnosticResult["fsrsProfile"]): Card {
  // Mutate card with calibrated starting state
  const now = new Date();
  card.stability = profile.initialStability;
  card.difficulty = profile.initialDifficulty;
  card.due = now;
  card.reps = 0;
  card.lapses = 0;
  card.state = 0; // New
  card.last_review = undefined;
  return card;
}

function round(x: number, n: number) {
  const f = Math.pow(10, n);
  return Math.round(x * f) / f;
}
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Heuristic: extract "control questions" from a syllabus text.
 * Real implementation would use LLM; this generates a baseline set
 * by pulling topic keywords and forming "What is X?" / "List Y of Z" prompts.
 *
 * Used as fallback when no LLM available.
 */
export function generateHeuristicQuestions(
  topicId: string,
  syllabusText: string,
  maxQuestions: number = 10,
): DiagnosticQuestion[] {
  const concepts = extractConcepts(syllabusText);
  const questions: DiagnosticQuestion[] = [];

  for (let i = 0; i < concepts.length && questions.length < maxQuestions; i++) {
    const c = concepts[i];
    questions.push({
      id: `${topicId}-q-${i}`,
      prompt: `¿Qué sabes sobre "${c.term}"?`,
      options: undefined,
      correct: c.definition,
      concept: c.term,
      weight: 1,
    });
  }
  return questions;
}

interface Concept {
  term: string;
  definition: string;
}

function extractConcepts(text: string): Concept[] {
  // Naive extraction: lines starting with "-", "•", or numbered, with " – " or ":" separator.
  const out: Concept[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:[-•*]|\d+[.)])\s*([^:–—\-]{2,80})\s*[:\-–—]\s*(.{3,200})$/);
    if (m) {
      out.push({ term: m[1].trim(), definition: m[2].trim() });
    }
  }
  return out.slice(0, 30);
}
