// Adaptive quiz engine: knowledge graph + gaps.

import type { KnowledgeLayer } from "./adaptiveQuizTypes.js";
import { LAYER_ORDER } from "./adaptiveQuizTypes.js";
import type { KnowledgeConcept, ConceptLayer, KnowledgeGraph, KnowledgeGap } from "./adaptiveQuizTypes.js";

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
