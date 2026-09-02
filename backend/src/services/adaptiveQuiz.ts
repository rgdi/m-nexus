// v0.28: Motor de quiz adaptativo y knowledge graph.
// Versión simplificada (sin acoplamiento a obsidian) que se ejecuta en el backend.

export type KnowledgeLayer =
  | "definition"
  | "epidemiology"
  | "etiology"
  | "symptom"
  | "diagnosis"
  | "differential"
  | "treatment"
  | "prevention"
  | "prognosis"
  | "complication";

export const LAYER_ORDER: KnowledgeLayer[] = [
  "definition", "epidemiology", "etiology", "symptom", "diagnosis",
  "differential", "treatment", "prevention", "prognosis", "complication",
];

export const LAYER_LABELS: Record<KnowledgeLayer, string> = {
  definition: "Definición",
  epidemiology: "Epidemiología",
  etiology: "Etiología",
  symptom: "Síntomas",
  diagnosis: "Diagnóstico",
  differential: "Diagnóstico diferencial",
  treatment: "Tratamiento",
  prevention: "Prevención",
  prognosis: "Pronóstico",
  complication: "Complicaciones",
};

export const LAYER_ICONS: Record<KnowledgeLayer, string> = {
  definition: "📖",
  epidemiology: "🌍",
  etiology: "❓",
  symptom: "🩺",
  diagnosis: "🔬",
  differential: "🔀",
  treatment: "💊",
  prevention: "🛡️",
  prognosis: "📈",
  complication: "⚠️",
};

export interface ConceptLayer {
  layer: KnowledgeLayer;
  mastery: number;
  lastReviewed: number;
  correct: number;
  incorrect: number;
  shown: number;
}

export interface KnowledgeConcept {
  id: string;
  term: string;
  aliases: string[];
  category: string;
  tags: string[];
  sources: string[];
  layers: Record<KnowledgeLayer, ConceptLayer>;
  updatedAt: number;
}

export interface KnowledgeGraph {
  concepts: Map<string, KnowledgeConcept>;
  byTerm: Map<string, string>;
}

/** Crea un concept vacío. */
export function createConcept(id: string, term: string, opts: Partial<KnowledgeConcept> = {}): KnowledgeConcept {
  const layers = {} as Record<KnowledgeLayer, ConceptLayer>;
  for (const layer of LAYER_ORDER) {
    layers[layer] = { layer, mastery: 0, lastReviewed: 0, correct: 0, incorrect: 0, shown: 0 };
  }
  return {
    id,
    term,
    aliases: opts.aliases ?? [],
    category: opts.category ?? "general",
    tags: opts.tags ?? [],
    sources: opts.sources ?? [],
    layers,
    updatedAt: Date.now(),
  };
}

export function addConcept(graph: KnowledgeGraph, concept: KnowledgeConcept): void {
  graph.concepts.set(concept.id, concept);
  graph.byTerm.set(concept.term.toLowerCase(), concept.id);
}

export function getConcept(graph: KnowledgeGraph, id: string): KnowledgeConcept | null {
  return graph.concepts.get(id) ?? null;
}

export function findByTerm(graph: KnowledgeGraph, term: string): KnowledgeConcept | null {
  const id = graph.byTerm.get(term.toLowerCase());
  if (!id) return null;
  return graph.concepts.get(id) ?? null;
}

export function allConcepts(graph: KnowledgeGraph): KnowledgeConcept[] {
  return Array.from(graph.concepts.values());
}

/** Actualiza la mastery de un concept en una capa con un resultado booleano. */
export function updateMastery(
  graph: KnowledgeGraph,
  conceptId: string,
  layer: KnowledgeLayer,
  correct: boolean,
  confidence: number = 1,
): void {
  const concept = graph.concepts.get(conceptId);
  if (!concept) return;
  const layerData = concept.layers[layer];
  if (correct) {
    layerData.mastery = Math.min(1, layerData.mastery + 0.1 * confidence);
    layerData.correct++;
  } else {
    layerData.mastery = Math.max(0, layerData.mastery - 0.2 * confidence);
    layerData.incorrect++;
  }
  layerData.lastReviewed = Date.now();
  concept.updatedAt = Date.now();
}

export function markShown(graph: KnowledgeGraph, conceptId: string, layer: KnowledgeLayer): void {
  const concept = graph.concepts.get(conceptId);
  if (!concept) return;
  concept.layers[layer].shown++;
  concept.layers[layer].lastReviewed = Date.now();
}

export interface KnowledgeGap {
  concept: KnowledgeConcept;
  layer: KnowledgeLayer;
  priority: number;
  mastery: number;
  importance: number;
  decay: number;
  sequenceBonus: number;
}

/** Encuentra las lagunas (mastery < 0.8) y las ordena por prioridad. */
export function findGaps(graph: KnowledgeGraph, limit: number = 20): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = [];
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const CRITICAL_LAYERS: Set<KnowledgeLayer> = new Set(["definition", "symptom", "treatment"]);

  for (const concept of allConcepts(graph)) {
    for (const layer of LAYER_ORDER) {
      const data = concept.layers[layer];
      if (data.mastery >= 0.8) continue;
      // Importance
      const importance = CRITICAL_LAYERS.has(layer) ? 1.5 : 1.0;
      // Decay
      const daysSince = data.lastReviewed > 0 ? (now - data.lastReviewed) / DAY : 30;
      const decay = Math.min(1, daysSince / 30);
      // Sequence bonus: si las críticas anteriores están dominadas
      let sequenceBonus = 0;
      if (CRITICAL_LAYERS.has(layer)) {
        const prevCritical = ["definition", "symptom", "treatment"].filter(
          (l) => (CRITICAL_LAYERS as Set<string>).has(l) && l !== layer,
        );
        const allPrevDominated = prevCritical.every(
          (l) => concept.layers[l as KnowledgeLayer].mastery >= 0.8,
        );
        if (allPrevDominated) sequenceBonus = 0.5;
      }
      const priority = (1 - data.mastery) * importance + decay + sequenceBonus;
      gaps.push({
        concept,
        layer,
        priority,
        mastery: data.mastery,
        importance,
        decay,
        sequenceBonus,
      });
    }
  }
  gaps.sort((a, b) => b.priority - a.priority);
  return gaps.slice(0, limit);
}

/** Construye una pregunta concisa para una capa de un concept. */
export function buildQuestionForGap(gap: KnowledgeGap): { text: string; correctAnswer: string; hint: string } {
  const term = gap.concept.term;
  switch (gap.layer) {
    case "definition":
      return {
        text: `¿Qué es ${term}?`,
        correctAnswer: term,
        hint: `Repasa la definición de ${term}`,
      };
    case "epidemiology":
      return {
        text: `¿A quién afecta ${term}?`,
        correctAnswer: "(población/edad/sexo)",
        hint: `Piensa en prevalencia e incidencia`,
      };
    case "etiology":
      return {
        text: `¿Por qué ocurre ${term}?`,
        correctAnswer: "(causas/factores de riesgo)",
        hint: `Factores de riesgo y mecanismos`,
      };
    case "symptom":
      return {
        text: `¿Cómo se manifiesta ${term}?`,
        correctAnswer: "(síntomas principales)",
        hint: `Síntomas cardinales`,
      };
    case "diagnosis":
      return {
        text: `¿Cómo se diagnostica ${term}?`,
        correctAnswer: "(criterios/pruebas)",
        hint: `Criterios diagnósticos`,
      };
    case "differential":
      return {
        text: `¿Con qué se confunde ${term}?`,
        correctAnswer: "(diagnósticos diferenciales)",
        hint: `Diagnósticos diferenciales principales`,
      };
    case "treatment":
      return {
        text: `¿Cómo se trata ${term}?`,
        correctAnswer: "(tratamiento principal)",
        hint: `Fármacos de primera línea`,
      };
    case "prevention":
      return {
        text: `¿Cómo se previene ${term}?`,
        correctAnswer: "(medidas preventivas)",
        hint: `Prevención primaria/secundaria`,
      };
    case "prognosis":
      return {
        text: `¿Qué pasa después con ${term}?`,
        correctAnswer: "(pronóstico)",
        hint: `Pronóstico a corto/largo plazo`,
      };
    case "complication":
      return {
        text: `¿Qué complicaciones tiene ${term}?`,
        correctAnswer: "(complicaciones)",
        hint: `Complicaciones agudas/crónicas`,
      };
  }
}

/** Sugiere la siguiente capa a estudiar para un concept. */
export function suggestNextLayer(
  concept: KnowledgeConcept,
  currentLayer: KnowledgeLayer,
): KnowledgeLayer {
  const currentIdx = LAYER_ORDER.indexOf(currentLayer);
  for (let i = currentIdx + 1; i < LAYER_ORDER.length; i++) {
    const layer = LAYER_ORDER[i];
    if (concept.layers[layer].mastery < 0.8) return layer;
  }
  return currentLayer;
}

/** Compara dos respuestas con sinonimia y fuzzy matching. */
export function checkAnswer(correct: string, user: string, acceptedAnswers?: string[]): boolean {
  const normalize = (s: string) => s.toLowerCase().trim().replace(/[^\w\sáéíóúüñ]/g, "");
  const u = normalize(user);
  const c = normalize(correct);
  if (u === c) return true;
  if (acceptedAnswers) {
    for (const a of acceptedAnswers) {
      if (normalize(a) === u) return true;
    }
  }
  const correctWords = new Set(c.split(/\s+/).filter((w) => w.length > 3));
  const userWords = u.split(/\s+/);
  let matches = 0;
  for (const w of userWords) {
    if (correctWords.has(w)) matches++;
  }
  if (correctWords.size > 0 && matches / correctWords.size >= 0.7) return true;
  return false;
}

// ── Quiz session API ──

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
