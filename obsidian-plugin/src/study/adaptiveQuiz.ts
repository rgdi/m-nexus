// ⚠️ DEPRECATED v0.28: Esta lógica se ejecuta en el backend.
// El plugin debe usar src/services/aiClient.ts en su lugar.
// Esta implementación se mantiene solo como fallback offline y para tests.
// Migrar a backend: import { backendEvalVault, backendGenerateProposals, etc. } from './services/aiClient';
// v0.28: Adaptive Quiz — preguntas capa-por-capa.
// Detecta lagunas: si el usuario sabe la afección pero no el tratamiento,
// pregunta por el tratamiento directamente.

import type { KnowledgeGraph, KnowledgeConcept, KnowledgeLayer, ConceptLayer } from "./knowledgeLayers";
import { LAYER_LABELS, LAYER_ICONS, LAYER_ORDER } from "./knowledgeLayers";

export type QuestionType =
  | "recall"        // "¿Qué es X?"
  | "symptom"       // "¿Cuáles son los síntomas de X?"
  | "diagnosis"     // "¿Cómo se diagnostica X?"
  | "treatment"     // "¿Cómo se trata X?"
  | "match"         // "Relaciona: síntoma → enfermedad"
  | "fill-blank"    // "La membrana ___ es..."
  | "true-false"    // "¿Verdadero o falso?"
  | "scenario"      // "Paciente con X, Y, Z. ¿Diagnóstico?"

export interface Question {
  id: string;
  type: QuestionType;
  concept: KnowledgeConcept;
  layer: KnowledgeLayer;
  /** Texto de la pregunta (conciso). */
  text: string;
  /** Si tiene opciones, las opciones. */
  options?: string[];
  /** Respuesta correcta (string normalizado). */
  correctAnswer: string;
  /** Respuestas alternativas aceptadas. */
  acceptedAnswers?: string[];
  /** Hint que se muestra si falla. */
  hint?: string;
  /** Por qué se está preguntando esto. */
  reason: string;
  /** Si ya fue vista antes. */
  seenBefore: boolean;
}

export interface QuizSession {
  id: string;
  startedAt: number;
  questions: Question[];
  currentIndex: number;
  responses: Array<{ questionId: string; answer: string; correct: boolean; timeMs: number; confidence: number }>;
  completed: boolean;
  /** Configuración. */
  config: {
    maxQuestions: number;
    /** Si debe parar cuando detecta conocimiento alto. */
    stopOnMastery: boolean;
    /** Modo: "diagnostic" (preguntar lo que no sabe) o "review" (todo). */
    mode: "diagnostic" | "review" | "exam";
  };
}

export class AdaptiveQuizEngine {
  private session: QuizSession | null = null;

  constructor(
    private graph: KnowledgeGraph,
    private config: QuizSession["config"] = { maxQuestions: 30, stopOnMastery: true, mode: "diagnostic" },
  ) {}

  /** Factory helper: crea una QuizSession con config parcial. */
  static createSession(
    config: Partial<QuizSession["config"]> = {},
  ): QuizSession {
    const fullConfig: QuizSession["config"] = {
      maxQuestions: 30,
      stopOnMastery: true,
      mode: "diagnostic",
      ...config,
    };
    return {
      id: `qs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      startedAt: Date.now(),
      questions: [],
      currentIndex: 0,
      responses: [],
      completed: false,
      config: fullConfig,
    };
  }

  /** Inicia una nueva sesión. */
  startSession(): QuizSession {
    this.session = {
      id: `qs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      startedAt: Date.now(),
      questions: [],
      currentIndex: 0,
      responses: [],
      completed: false,
      config: this.config,
    };
    return this.session;
  }

  /** Obtiene la sesión actual. */
  getSession(): QuizSession | null {
    return this.session;
  }

  /**
   * Genera la siguiente pregunta usando el algoritmo adaptativo.
   * Estrategia:
   * 1. Buscar gaps en el knowledge graph
   * 2. Para cada gap, decidir si preguntar la capa más débil o skip
   * 3. Generar la pregunta según el tipo de capa
   */
  nextQuestion(): Question | null {
    if (!this.session) this.startSession();
    if (this.session!.completed) return null;
    if (this.session!.questions.length >= this.session!.config.maxQuestions) {
      this.session!.completed = true;
      return null;
    }

    const gaps = this.graph.findGaps(50);
    if (gaps.length === 0) {
      this.session!.completed = true;
      return null;
    }

    // Encontrar la primera pregunta que NO haya sido vista en esta sesión
    const seen = new Set(this.session!.questions.map((q) => q.id));
    for (const gap of gaps) {
      const q = this.buildQuestionForGap(gap.concept, gap.layer);
      if (!seen.has(q.id)) {
        // Marcar la capa como mostrada (para que findGaps no la devuelva otra vez)
        this.graph.markShown(gap.concept.id, gap.layer);
        this.session!.questions.push(q);
        return q;
      }
    }
    // Si todas fueron vistas, completar
    this.session!.completed = true;
    return null;
  }

  /**
   * Responde la pregunta actual y actualiza el knowledge graph.
   */
  async answerCurrent(answer: string, confidence: number = 1, timeMs: number = 0): Promise<{ correct: boolean; feedback: string; nextLayer?: KnowledgeLayer; mastered: boolean }> {
    if (!this.session) throw new Error("No session");
    const q = this.session.questions[this.session.currentIndex];
    if (!q) throw new Error("No current question");

    const isCorrect = this.checkAnswer(q, answer);
    this.session.responses.push({
      questionId: q.id,
      answer,
      correct: isCorrect,
      timeMs,
      confidence,
    });

    // Actualizar knowledge graph
    this.graph.updateMastery(q.concept.id, q.layer, isCorrect, confidence);

    // Generar feedback y sugerir siguiente capa
    const feedback = isCorrect
      ? `✅ Correcto. Dominio de ${LAYER_LABELS[q.layer]} ahora: ${Math.round(q.concept.layers[q.layer].mastery * 100)}%`
      : `❌ Incorrecto. ${q.hint ?? "Revisa " + LAYER_LABELS[q.layer]}`;

    const nextLayer = isCorrect ? this.suggestNextLayer(q.concept, q.layer) : q.layer;

    this.session.currentIndex++;
    // No marcar completed por responder una sola — solo si se acaban las preguntas
    if (this.session.currentIndex >= this.session.questions.length) {
      // Verificar si hay más gaps para seguir preguntando
      const remainingGaps = this.graph.findGaps(1);
      if (remainingGaps.length === 0 || this.session.responses.length >= this.session.config.maxQuestions) {
        this.session.completed = true;
      } else {
        // Resetear para permitir más preguntas
        this.session.currentIndex = this.session.questions.length;
      }
    }

    return {
      correct: isCorrect,
      feedback,
      nextLayer,
      mastered: q.concept.layers[q.layer].mastery >= 0.8,
    };
  }

  /** Resultado de la sesión. */
  sessionResult(): {
    totalQuestions: number;
    correct: number;
    accuracy: number;
    averageConfidence: number;
    layersImproved: Array<{ concept: string; layer: KnowledgeLayer; from: number; to: number }>;
    durationMs: number;
  } {
    if (!this.session) return { totalQuestions: 0, correct: 0, accuracy: 0, averageConfidence: 0, layersImproved: [], durationMs: 0 };
    const correct = this.session.responses.filter((r) => r.correct).length;
    const total = this.session.responses.length;
    const avgConf = total > 0 ? this.session.responses.reduce((s, r) => s + r.confidence, 0) / total : 0;
    const duration = Date.now() - this.session.startedAt;
    return {
      totalQuestions: total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
      averageConfidence: avgConf,
      layersImproved: [], // se podría computar comparando mastery antes/después
      durationMs: duration,
    };
  }

  /**
   * Genera una pregunta concisa para un gap específico.
   * El formato es siempre corto: una línea.
   */
  private static _qCounter = 0;
  private buildQuestionForGap(concept: KnowledgeConcept, layer: KnowledgeLayer): Question {
    AdaptiveQuizEngine._qCounter++;
    const id = `q-${concept.id}-${layer}-${Date.now()}-${AdaptiveQuizEngine._qCounter}`;
    const term = concept.term;
    const seenBefore = concept.layers[layer].shown > 0;

    let type: QuestionType;
    let text: string;
    let correctAnswer: string;
    let hint: string;
    let reason: string;

    switch (layer) {
      case "definition":
        type = "recall";
        text = `¿Qué es ${term}?`;
        correctAnswer = term;
        hint = `Repasa la definición de ${term}`;
        reason = `Laguna: definición (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "symptom":
        type = "symptom";
        text = `Síntomas principales de ${term}:`;
        correctAnswer = "(lista de síntomas)";
        hint = `Busca los síntomas cardinales de ${term}`;
        reason = `Laguna: síntomas (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "diagnosis":
        type = "diagnosis";
        text = `¿Cómo se diagnostica ${term}?`;
        correctAnswer = "(criterios diagnósticos)";
        hint = `Revisa los criterios diagnósticos de ${term}`;
        reason = `Laguna: diagnóstico (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "treatment":
        type = "treatment";
        text = `Tratamiento de 1ª línea de ${term}:`;
        correctAnswer = "(tratamiento principal)";
        hint = `Busca el tratamiento de primera línea`;
        reason = `Laguna: tratamiento (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "differential":
        type = "match";
        text = `¿Con qué se confunde ${term}?`;
        correctAnswer = "(diagnósticos diferenciales)";
        hint = `Piensa en el diagnóstico diferencial principal`;
        reason = `Laguna: diferencial (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "prognosis":
        type = "true-false";
        text = `Pronóstico de ${term}:`;
        correctAnswer = "(pronóstico)";
        hint = `Busca la mortalidad / morbilidad a 5 años`;
        reason = `Laguna: pronóstico (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "complication":
        type = "recall";
        text = `Complicaciones graves de ${term}:`;
        correctAnswer = "(complicaciones)";
        hint = `Revisa las complicaciones más severas`;
        reason = `Laguna: complicaciones (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "etiology":
        type = "recall";
        text = `Causa de ${term}:`;
        correctAnswer = "(etiología)";
        hint = `Busca las causas principales`;
        reason = `Laguna: etiología (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "epidemiology":
        type = "true-false";
        text = `¿A quién afecta más ${term}?`;
        correctAnswer = "(población)";
        hint = `Piensa en edad, sexo, geografía`;
        reason = `Laguna: epidemiología (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
      case "prevention":
        type = "recall";
        text = `¿Cómo se previene ${term}?`;
        correctAnswer = "(medidas preventivas)";
        hint = `Revisa las medidas de prevención`;
        reason = `Laguna: prevención (maestría ${Math.round(concept.layers[layer].mastery * 100)}%)`;
        break;
    }

    return {
      id,
      type,
      concept,
      layer,
      text,
      correctAnswer,
      hint,
      reason,
      seenBefore,
    };
  }

  private checkAnswer(q: Question, answer: string): boolean {
    const normalize = (s: string) => s.toLowerCase().trim().replace(/[^\w\sáéíóúüñ]/g, "");
    const userAnswer = normalize(answer);
    const correct = normalize(q.correctAnswer);
    if (userAnswer === correct) return true;
    if (q.acceptedAnswers) {
      for (const a of q.acceptedAnswers) {
        if (normalize(a) === userAnswer) return true;
      }
    }
    // Matching difuso: 80% de las palabras correctas
    const correctWords = new Set(correct.split(/\s+/).filter((w) => w.length > 3));
    const userWords = userAnswer.split(/\s+/);
    let matches = 0;
    for (const w of userWords) {
      if (correctWords.has(w)) matches++;
    }
    if (correctWords.size > 0 && matches / correctWords.size >= 0.7) return true;
    return false;
  }

  /**
   * Sugiere la siguiente capa a estudiar basándose en el dominio actual.
   * Si acaba de dominar "síntoma" (>=0.8), sugiere la siguiente capa no dominada.
   * Si falló, repite la misma.
   */
  private suggestNextLayer(concept: KnowledgeConcept, currentLayer: KnowledgeLayer): KnowledgeLayer | undefined {
    // Si la capa actual está dominada, ir a la siguiente en orden
    if (concept.layers[currentLayer].mastery >= 0.8) {
      const idx = LAYER_ORDER.indexOf(currentLayer);
      for (let i = idx + 1; i < LAYER_ORDER.length; i++) {
        if (concept.layers[LAYER_ORDER[i]].mastery < 0.8) {
          return LAYER_ORDER[i];
        }
      }
    }
    return undefined;
  }
}

/** Render del quiz en formato compacto (una línea por pregunta). */
export function renderQuizCompact(q: Question): string {
  const icon = LAYER_ICONS[q.layer];
  return `${icon} **${q.text}** _(capa: ${LAYER_LABELS[q.layer]})_`;
}

/**
 * Helper top-level para crear una QuizSession. Equivalente a
 * `AdaptiveQuizEngine.createSession(config)`.
 */
export function createQuizSession(
  config: Partial<QuizSession["config"]> = {},
): QuizSession {
  return AdaptiveQuizEngine.createSession(config);
}
