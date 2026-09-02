// v0.28: Conector entre KnowledgeGraph (evaluación) y ExamScheduler / loadBalancer.
//
// Idea: el sistema de evaluación (knowledge graph) le dice al scheduler qué
// conceptos están "débiles" y deben repasarse antes del examen. Esto se traduce
// en:
//
//   1. boost de priority: cards en conceptos con mastery bajo se priorizan
//   2. boost de frecuencia: cards en conceptos no dominados se repasan más
//   3. boost de "pull-in": dueDate se adelanta al día del examen (o HOY si overdue)

import type { KnowledgeGraph, KnowledgeLayer } from "../study/knowledgeLayers";
import type { Flashcard } from "../exams/types.js";
import { shouldBoost, generateBoost, applyBoosts, type FSRSAdapter } from "../exams/fsrsIntegration.js";
import type { Exam } from "../exams/types.js";
import { rebalance, type RebalanceInput } from "./loadBalancer.js";

/** Configuración del boost por evaluación. */
export interface EvaluationBoostConfig {
  /** Si mastery está por debajo de este umbral, la card se considera "débil". */
  weakMasteryThreshold: number;
  /** Multiplicador de priority para cards en conceptos débiles. */
  weakPriorityBoost: number;
  /** Boost adicional por capa no dominada (1.0 = 100%). */
  layerPriorityBoost: number;
  /** Aplicar pull-in automático si hay examen activo. */
  autoPullIn: boolean;
  /** Si se debe usar el FSRS real (scheduler.ts) para calcular dueDate. */
  useRealFSRS: boolean;
}

export const DEFAULT_EVALUATION_BOOST_CONFIG: EvaluationBoostConfig = {
  weakMasteryThreshold: 0.6,
  weakPriorityBoost: 1.5,
  layerPriorityBoost: 1.0,
  autoPullIn: true,
  useRealFSRS: true,
};

/** Resultado del scoring con evaluación. */
export interface EvaluatedCard {
  card: Flashcard;
  priority: number;
  reason: string;
  weakConcepts: string[];
  weakLayers: KnowledgeLayer[];
  masteryScore: number;
}

/**
   Asocia una flashcard con su concepto en el knowledge graph.
   Heurística: matching por palabras significativas (case-insensitive, sin acentos).
   Si una palabra significativa del término aparece como prefijo (≥4 chars) o completa
   en el cardText, hay match. Esto cubre casos como "cardio" → "Cardiología".
*/
export function associateCardToConcept(
  card: Flashcard,
  graph: KnowledgeGraph,
): { conceptId: string; layer: KnowledgeLayer } | null {
  const all = graph.all();
  const cardText = `${card.notePath} ${card.tags.join(" ")} ${card.front} ${card.back}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  for (const concept of all) {
    const term = concept.term
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (term.length === 0) continue;
    // Stopwords en español
    const stopwords = new Set(["de", "la", "el", "y", "a", "en", "del", "al", "los", "las", "un", "una", "por", "para", "con", "sin", "tipo", "que", "se", "es", "ia", "ia"]);
    const words = term.split(/\s+/).filter((w) => w.length > 2 && !stopwords.has(w));
    if (words.length === 0) {
      if (cardText.includes(term)) {
        return { conceptId: concept.id, layer: "definition" };
      }
      continue;
    }
    // Verificar que al menos una palabra significativa matchee (como prefijo o completa)
    const hasMatch = words.some((w) => {
      // Match exacto
      if (cardText.includes(w)) return true;
      // Match por prefijo (≥4 chars): "cardio" en "cardio.md" o "cardiologia"
      if (w.length >= 4) {
        // Buscar palabras en el cardText que empiecen por w
        const tokens = cardText.split(/\W+/);
        return tokens.some((t) => t.startsWith(w) || w.startsWith(t));
      }
      return false;
    });
    if (hasMatch) {
      // Encontrar la capa más débil
      let weakest: KnowledgeLayer = "definition";
      let weakestMastery = 1;
      for (const layer of Object.keys(concept.layers) as KnowledgeLayer[]) {
        const m = concept.layers[layer].mastery;
        if (m < weakestMastery) {
          weakestMastery = m;
          weakest = layer;
        }
      }
      return { conceptId: concept.id, layer: weakest };
    }
  }
  return null;
}

/**
   Evalúa un conjunto de cards contra el knowledge graph.
   Devuelve un scoring que prioriza cards en conceptos débiles.
*/
export function evaluateCards(
  cards: Flashcard[],
  graph: KnowledgeGraph,
  config: Partial<EvaluationBoostConfig> = {},
): EvaluatedCard[] {
  const cfg = { ...DEFAULT_EVALUATION_BOOST_CONFIG, ...config };
  const result: EvaluatedCard[] = [];

  for (const card of cards) {
    const association = associateCardToConcept(card, graph);
    const cardPriority = (card as { priority?: string }).priority;
    const basePriority = cardPriority === "High" ? 100 : cardPriority === "Normal" ? 50 : 10;
    let finalPriority = basePriority;
    let reason = "no-concept-association";
    const weakConcepts: string[] = [];
    const weakLayers: KnowledgeLayer[] = [];
    let totalMastery = 0;

    if (association) {
      const concept = graph.get(association.conceptId);
      if (concept) {
        const layerData = concept.layers[association.layer];
        const mastery = layerData.mastery;
        totalMastery = mastery;
        if (mastery < cfg.weakMasteryThreshold) {
          // Concepto débil → boost
          weakConcepts.push(concept.term);
          finalPriority *= cfg.weakPriorityBoost;
          weakLayers.push(association.layer);
          reason = `weak:${concept.term}:${association.layer}`;
        } else {
          reason = `mastered:${concept.term}:${association.layer}`;
        }
      }
    }

    result.push({
      card,
      priority: finalPriority,
      reason,
      weakConcepts,
      weakLayers,
      masteryScore: totalMastery,
    });
  }

  // Ordenar por prioridad descendente
  result.sort((a, b) => b.priority - a.priority);
  return result;
}

/**
   Integra la evaluación con el loadBalancer.
   Cards en conceptos débiles se priorizan y se repasan más a menudo.
*/
export function rebalanceWithEvaluation(
  input: RebalanceInput,
  graph: KnowledgeGraph,
  config: Partial<EvaluationBoostConfig> = {},
): {
  schedule: Map<string, Flashcard[]>;
  loads: Array<{ date: string; cards: number; weakCards: number; estimatedMinutes: number; overflow: boolean }>;
  overflow: boolean;
  movedCount: number;
} {
  const cards = input.cards.map((c) => c.card);
  const evaluated = evaluateCards(cards, graph, config);

  // Crear buckets manualmente
  const DAY_MS = 24 * 3600 * 1000;
  const buckets = new Map<string, Flashcard[]>();
  for (let i = 0; i < input.daysWindow; i++) {
    const d = new Date(input.today.getTime() + i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, []);
  }
  const lastKey = (() => {
    const d = new Date(input.today.getTime() + (input.daysWindow - 1) * DAY_MS);
    return d.toISOString().slice(0, 10);
  })();

  // Distribuir: las más prioritarias primero
  for (const ev of evaluated) {
    const dueDate = ev.card.fsrs ? new Date(ev.card.fsrs.dueDate) : new Date();
    let dueKey = dueDate.toISOString().slice(0, 10);
    if (!buckets.has(dueKey)) dueKey = lastKey;
    const evPriority = (ev.card as { priority?: string }).priority;
    const cap = evPriority === "High" ? input.dailyReviewCap : input.softCap;
    if (buckets.get(dueKey)!.length < cap) {
      buckets.get(dueKey)!.push(ev.card);
    } else {
      // Buscar día con hueco
      let targetKey = dueKey;
      const keys = Array.from(buckets.keys());
      const idx = keys.indexOf(dueKey);
      for (let i = idx + 1; i < keys.length; i++) {
        if (buckets.get(keys[i])!.length < cap) {
          targetKey = keys[i];
          break;
        }
      }
      buckets.get(targetKey)!.push(ev.card);
    }
  }

  const loads: Array<{ date: string; cards: number; weakCards: number; estimatedMinutes: number; overflow: boolean }> = [];
  let totalOverflow = false;
  for (const [key, list] of buckets.entries()) {
    const overflow = list.length > input.dailyReviewCap;
    if (overflow) totalOverflow = true;
    const weakCards = list.filter((c) => {
      const ev = evaluated.find((e) => e.card.id === c.id);
      return ev && ev.weakConcepts.length > 0;
    }).length;
    loads.push({
      date: key,
      cards: list.length,
      weakCards,
      estimatedMinutes: Math.round(list.length * 0.5),
      overflow,
    });
  }
  return { schedule: buckets, loads, overflow: totalOverflow, movedCount: 0 };
}

/**
   Aplica el flujo completo:
   1. Score con knowledge graph
   2. Boost FSRS-aware (pull-in por examen)
   3. Devuelve cards listas para el loadBalancer
*/
export function evaluateAndBoost(
  cards: Flashcard[],
  graph: KnowledgeGraph,
  exam: Exam | null,
  options: {
    evalConfig?: Partial<EvaluationBoostConfig>;
    fsrsAdapter?: FSRSAdapter;
  } = {},
): {
  evaluated: EvaluatedCard[];
  boosted: Flashcard[];
  boosts: ReturnType<typeof applyBoosts>["boosts"];
} {
  const evaluated = evaluateCards(cards, graph, options.evalConfig);

  // Si hay examen, aplicar boost
  if (exam && options.evalConfig?.autoPullIn !== false) {
    const result = applyBoosts(cards, exam, undefined, options.fsrsAdapter);
    return { evaluated, boosted: result.updated as Flashcard[], boosts: result.boosts };
  }

  return { evaluated, boosted: cards, boosts: [] };
}
