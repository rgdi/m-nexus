// v0.28: KnowledgeBoost — conecta el knowledge graph con el FSRS.
// Cuando un usuario demuestra conocer un concepto, las flashcards relacionadas se
// vuelven más fáciles (mayor stability). Si falla, se vuelven más difíciles (lapse).

import type { KnowledgeGraph, KnowledgeLayer } from "../study/knowledgeLayers";
import { FsrsCard, review, Rating } from "./scheduler";

/** Configuración del boost. */
export interface BoostConfig {
  /** Cuánto afecta un dominio del 100% a la stability. */
  masteryMultiplier: number;
  /** Cap de stability (días). */
  maxStability: number;
  /** Si debe aplicar a todas las flashcards del concepto. */
  applyToAllLayers: boolean;
}

const DEFAULT_CONFIG: BoostConfig = {
  masteryMultiplier: 2.0, // 100% maestría = stability x3
  maxStability: 365, // 1 año
  applyToAllLayers: true,
};

/** Asocia una flashcard con un concepto y capa. */
export interface FlashcardConceptLink {
  card: FsrsCard;
  conceptId: string;
  layer: KnowledgeLayer;
}

/**
 * Aplica un boost a la stability de las flashcards según el dominio del knowledge graph.
 * Si el usuario domina la capa, sube stability; si no, baja.
 */
export function applyKnowledgeBoost(
  card: FsrsCard,
  conceptId: string,
  layer: KnowledgeLayer,
  graph: KnowledgeGraph,
  config: Partial<BoostConfig> = {},
): FsrsCard {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const concept = graph.get(conceptId);
  if (!concept) return card;
  const layerData = concept.layers[layer];
  if (!layerData) return card;

  const mastery = layerData.mastery;
  // mastery=0 → -50% stability, mastery=1 → +100% stability
  const boostFactor = 1 + (mastery - 0.5) * cfg.masteryMultiplier;
  const newStability = Math.max(0.1, Math.min(cfg.maxStability, card.stability * boostFactor));

  return { ...card, stability: newStability };
}

/**
 * Simula el efecto de un quiz adaptativo sobre un conjunto de flashcards.
 * Devuelve las flashcards con su nueva state después del boost.
 */
export function simulateQuizImpact(
  links: FlashcardConceptLink[],
  graph: KnowledgeGraph,
  rating: Rating,
  config: Partial<BoostConfig> = {},
): FsrsCard[] {
  const result: FsrsCard[] = [];
  for (const link of links) {
    // Primero: aplicar review normal
    const reviewed = review(link.card, rating);
    // Luego: boost por knowledge
    const boosted = applyKnowledgeBoost(
      reviewed.card,
      link.conceptId,
      link.layer,
      graph,
      config,
    );
    result.push(boosted);
  }
  return result;
}

/**
 * Estrategia simplificada: el dominio del knowledge graph actúa como un multiplicador
 * del rating efectivo.
 * - Si rating=4 (Easy) y mastery=1 → super-Easy → stability crece mucho
 * - Si rating=1 (Again) y mastery=0 → super-Again → stability baja mucho
 * - Si rating=3 (Good) y mastery=0.5 → neutral
 *
 * IMPORTANTE: si el usuario falla (rating=1), el mastery NO puede "ascender"
 * el rating efectivo — solo puede mantenerlo o bajarlo. La lógica de "el conocimiento
 * previo me ayuda" solo aplica cuando el usuario NO falla.
 */
export function effectiveRating(
  userRating: Rating,
  mastery: number,
): Rating {
  // Si el usuario falla, el mastery no puede ascender el rating
  if (userRating === 1) return 1;
  // Map mastery (0..1) to modifier (-1..+1)
  const modifier = (mastery - 0.5) * 2; // -1..+1
  // Translate rating to base score
  const baseScore = userRating; // 2..4
  // Apply modifier (solo para rating >= 2)
  const adjusted = baseScore + modifier;
  // Clamp to valid rating
  if (adjusted <= 2) return 2;
  if (adjusted >= 4) return 4;
  if (adjusted < 2.5) return 2;
  if (adjusted < 3.5) return 3;
  return 4;
}
