// Adaptive quiz: sessions + re-exports for backward compat.


import type { KnowledgeLayer, KnowledgeGraph, KnowledgeConcept } from "./adaptiveQuizTypes.js";
import { LAYER_LABELS, findGaps, markShown, updateMastery, buildQuestionForGap, checkAnswer, getConcept, suggestNextLayer } from "./adaptiveQuizEngine.js";
import type { KnowledgeGap } from "./adaptiveQuizEngine.js";
export * from "./adaptiveQuizTypes.js";
export * from "./adaptiveQuizEngine.js";

// Adaptive quiz: sessions.


export interface QuizSession {
  id: string;
  startedAt: number;
  questions: QuizQuestion[];
  currentIndex: number;
  responses: Array<{ questionId: string; answer: string; correct: boolean; timeMs: number; confidence: number }>;
  completed: boolean;
  config: { maxQuestions: number; stopOnMastery: boolean; mode: "diagnostic" | "review" | "exam" };
}

export interface QuizQuestion {
  id: string;
  type: "recall" | "cloze" | "list";
  conceptId: string;
  layer: KnowledgeLayer;
  text: string;
  correctAnswer: string;
  acceptedAnswers?: string[];
  hint: string;
  reason: string;
  seenBefore: boolean;
}

let _qCounter = 0;

export function newSession(config: Partial<QuizSession["config"]> = {}): QuizSession {
  return {
    id: `qs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    startedAt: Date.now(),
    questions: [],
    currentIndex: 0,
    responses: [],
    completed: false,
    config: { maxQuestions: 30, stopOnMastery: true, mode: "diagnostic", ...config },
  };
}

export function nextQuestion(graph: KnowledgeGraph, session: QuizSession): QuizQuestion | null {
  if (session.questions.length >= session.config.maxQuestions) {
    session.completed = true;
    return null;
  }
  const gaps = findGaps(graph, 1);
  if (gaps.length === 0) {
    session.completed = true;
    return null;
  }
  const gap = gaps[0];
  const built = buildQuestionForGap(gap);
  _qCounter++;
  const q: QuizQuestion = {
    id: `q-${gap.concept.id}-${gap.layer}-${Date.now()}-${_qCounter}`,
    type: "recall",
    conceptId: gap.concept.id,
    layer: gap.layer,
    text: built.text,
    correctAnswer: built.correctAnswer,
    hint: built.hint,
    reason: `Laguna: ${LAYER_LABELS[gap.layer]} (maestría ${Math.round(gap.mastery * 100)}%)`,
    seenBefore: false,
  };
  markShown(graph, gap.concept.id, gap.layer);
  session.questions.push(q);
  return q;
}

export interface AnswerResult {
  correct: boolean;
  feedback: string;
  nextLayer?: KnowledgeLayer;
  mastered: boolean;
}

export function answerQuestion(
  graph: KnowledgeGraph,
  session: QuizSession,
  answer: string,
  confidence: number = 1,
  timeMs: number = 0,
): AnswerResult {
  const q = session.questions[session.currentIndex];
  if (!q) throw new Error("No current question");
  const isCorrect = checkAnswer(q.correctAnswer, answer, q.acceptedAnswers);
  session.responses.push({ questionId: q.id, answer, correct: isCorrect, timeMs, confidence });
  updateMastery(graph, q.conceptId, q.layer, isCorrect, confidence);
  const concept = getConcept(graph, q.conceptId);
  const feedback = isCorrect
    ? `✅ Correcto. Dominio de ${LAYER_LABELS[q.layer]} ahora: ${Math.round((concept?.layers[q.layer].mastery ?? 0) * 100)}%`
    : `❌ Incorrecto. ${q.hint}`;
  const nextLayer = isCorrect && concept ? suggestNextLayer(concept, q.layer) : q.layer;
  session.currentIndex++;
  if (session.currentIndex >= session.questions.length) {
    const remaining = findGaps(graph, 1);
    if (remaining.length === 0 || session.responses.length >= session.config.maxQuestions) {
      session.completed = true;
    }
  }
  return { correct: isCorrect, feedback, nextLayer, mastered: (concept?.layers[q.layer].mastery ?? 0) >= 0.8 };
}

export interface SessionResult {
  totalQuestions: number;
  correct: number;
  accuracy: number;
  averageConfidence: number;
  durationMs: number;
  completed: boolean;
}

export function sessionResult(session: QuizSession): SessionResult {
  const total = session.responses.length;
  const correct = session.responses.filter((r) => r.correct).length;
  const avgConf = total > 0 ? session.responses.reduce((s, r) => s + r.confidence, 0) / total : 0;
  return {
    totalQuestions: total,
    correct,
    accuracy: total > 0 ? correct / total : 0,
    averageConfidence: avgConf,
    durationMs: Date.now() - session.startedAt,
    completed: session.completed,
  };
}
