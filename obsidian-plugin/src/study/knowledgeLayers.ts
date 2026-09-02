// ⚠️ DEPRECATED v0.28: Esta lógica se ejecuta en el backend.
// El plugin debe usar src/services/aiClient.ts en su lugar.
// Esta implementación se mantiene solo como fallback offline y para tests.
// Migrar a backend: import { backendEvalVault, backendGenerateProposals, etc. } from './services/aiClient';
// v0.28: Knowledge Layer System.
// Cada concepto se descompone en capas: definición, síntoma, diagnóstico, tratamiento, etc.
// Permite preguntas adaptativas capa-por-capa.
//
// v0.28: Logging exhaustivo integrado.

import { Logger } from "../utils/logger";

const log = new Logger("knowledge-graph");

export type KnowledgeLayer =
  | "definition"      // ¿Qué es X?
  | "etiology"        // ¿Por qué ocurre?
  | "symptom"         // ¿Cómo se manifiesta?
  | "diagnosis"       // ¿Cómo se diagnostica?
  | "treatment"       // ¿Cómo se trata?
  | "prognosis"       // ¿Qué pasa después?
  | "complication"    // ¿Qué complicaciones tiene?
  | "differential"    // ¿Con qué se confunde?
  | "epidemiology"    // ¿A quién afecta?
  | "prevention";     // ¿Cómo se previene?

export const LAYER_LABELS: Record<KnowledgeLayer, string> = {
  definition: "Definición",
  etiology: "Etiología",
  symptom: "Síntomas",
  diagnosis: "Diagnóstico",
  treatment: "Tratamiento",
  prognosis: "Pronóstico",
  complication: "Complicaciones",
  differential: "Diagnóstico diferencial",
  epidemiology: "Epidemiología",
  prevention: "Prevención",
};

export const LAYER_ICONS: Record<KnowledgeLayer, string> = {
  definition: "📖",
  etiology: "❓",
  symptom: "🩺",
  diagnosis: "🔬",
  treatment: "💊",
  prognosis: "📈",
  complication: "⚠️",
  differential: "🔀",
  epidemiology: "🌍",
  prevention: "🛡️",
};

/** Orden natural de las capas (de básico a avanzado). */
export const LAYER_ORDER: KnowledgeLayer[] = [
  "definition", "epidemiology", "etiology", "symptom", "diagnosis",
  "differential", "treatment", "prevention", "prognosis", "complication",
];

export interface ConceptLayer {
  layer: KnowledgeLayer;
  /** Confianza 0..1 de que el usuario lo sabe. */
  mastery: number;
  /** Última vez revisitado. */
  lastReviewed: number;
  /** Número de respuestas correctas. */
  correct: number;
  /** Número de respuestas incorrectas. */
  incorrect: number;
  /** Veces que se ha mostrado. */
  shown: number;
}

export interface KnowledgeConcept {
  /** ID único. */
  id: string;
  /** Término principal (ej: "Diabetes tipo 2"). */
  term: string;
  /** Sinónimos / variantes. */
  aliases: string[];
  /** Categoría. */
  category?: string;
  /** Capas del concepto. */
  layers: Record<KnowledgeLayer, ConceptLayer>;
  /** Tags para agrupación. */
  tags: string[];
  /** Fuentes. */
  sources: Array<{ type: "note" | "audio" | "pdf" | "manual"; ref: string }>;
  /** Última actualización. */
  updatedAt: number;
}

export class KnowledgeGraph {
  private concepts = new Map<string, KnowledgeConcept>();
  private conceptIndex = new Map<string, string>(); // alias → id

  add(concept: KnowledgeConcept): void {
    // BUG FIX: detectar ID duplicado
    if (this.concepts.has(concept.id)) {
      log.warn(`concept ID duplicado: ${concept.id} — sobrescribiendo`, {
        operation: "kg.add",
        data: { id: concept.id, term: concept.term },
      });
    }
    // BUG FIX: detectar término duplicado
    const termLower = concept.term.toLowerCase();
    if (this.conceptIndex.has(termLower) && this.conceptIndex.get(termLower) !== concept.id) {
      log.warn(`término duplicado: "${concept.term}" — concept existente será sobrescrito en índice`, {
        operation: "kg.add",
        data: { newId: concept.id, existingId: this.conceptIndex.get(termLower) },
      });
    }
    this.concepts.set(concept.id, concept);
    this.conceptIndex.set(termLower, concept.id);
    for (const a of concept.aliases) {
      const aliasLower = a.toLowerCase();
      if (this.conceptIndex.has(aliasLower) && this.conceptIndex.get(aliasLower) !== concept.id) {
        log.warn(`alias duplicado: "${a}"`, { operation: "kg.add" });
      }
      this.conceptIndex.set(aliasLower, concept.id);
    }
    log.debug(`concept added: ${concept.id} (${concept.term})`, { operation: "kg.add" });
  }

  get(id: string): KnowledgeConcept | null {
    return this.concepts.get(id) ?? null;
  }

  findByTerm(term: string): KnowledgeConcept | null {
    const id = this.conceptIndex.get(term.toLowerCase());
    if (!id) return null;
    return this.concepts.get(id) ?? null;
  }

  all(): KnowledgeConcept[] {
    return Array.from(this.concepts.values());
  }

  /**
   * Devuelve los conceptos ordenados por "lagunas de conocimiento".
   * Solo incluye capas NO dominadas (mastery < 0.8).
   * Prioriza: (1) capas con sequence bonus (siguiente capa lógica),
   * (2) capas importantes con baja maestría.
   */
  findGaps(limit = 20): Array<{ concept: KnowledgeConcept; layer: KnowledgeLayer; priority: number }> {
    const start = Date.now();
    const gaps: Array<{ concept: KnowledgeConcept; layer: KnowledgeLayer; priority: number }> = [];
    let conceptsScanned = 0;
    let layersScanned = 0;
    let layersSkipped = 0;
    for (const concept of this.concepts.values()) {
      conceptsScanned++;
      for (const layer of LAYER_ORDER) {
        layersScanned++;
        const l = concept.layers[layer];
        if (!l) {
          layersSkipped++;
          log.warn(`findGaps: concept ${concept.id} no tiene layer ${layer}`, { operation: "kg.findGaps" });
          continue;
        }
        if (l.mastery >= 0.8) continue;
        const gap = this.computeGap(concept, layer);
        if (gap > 0) {
          gaps.push({ concept, layer, priority: gap });
        }
      }
    }
    gaps.sort((a, b) => b.priority - a.priority);
    const topGaps = gaps.slice(0, limit);

    const durationMs = Date.now() - start;
    log.metric("kg_findgaps_duration_ms", durationMs);
    log.debug(
      `findGaps: scanned ${conceptsScanned} concepts, ${layersScanned} layers (${layersSkipped} skipped), found ${gaps.length} gaps, returning top ${topGaps.length}`,
      { operation: "kg.findGaps", data: { conceptsScanned, layersScanned, layersSkipped, totalGaps: gaps.length, returned: topGaps.length, durationMs } },
    );

    // Anomalía: ningún gap encontrado con > 5 concepts
    if (gaps.length === 0 && this.concepts.size > 5) {
      log.throttledWarn(
        "no-gaps-with-many-concepts",
        `findGaps retornó 0 con ${this.concepts.size} concepts — posible bug de mastery/umbral`,
        60_000,
        { operation: "kg.findGaps", data: { conceptCount: this.concepts.size } },
      );
    }
    return topGaps;
  }

  /**
   * Calcula la "laguna" de una capa específica.
   * Combina: 1 - mastery + importancia + tiempo sin revisar + sequence bonus.
   * Sequence bonus: si esta capa es la SIGUIENTE no dominada en el orden
   * de LAYER_ORDER (las anteriores no dominadas se priorizan sobre las tardías).
   */
  private computeGap(concept: KnowledgeConcept, layer: KnowledgeLayer): number {
    const l = concept.layers[layer];
    if (!l) return 0;
    const importance = (layer === "definition" || layer === "treatment" || layer === "symptom") ? 1.5 : 1.0;
    const knowledgeGap = 1 - l.mastery;
    const daysSince = l.lastReviewed > 0 ? (Date.now() - l.lastReviewed) / (24 * 3600_000) : 365;
    const decay = Math.min(1, daysSince / 30);

    // Sequence bonus: si esta capa es la "siguiente capa lógica".
    // Lógica: si las 3 primeras capas críticas (definition, symptom, treatment) tienen
    // las previas dominadas, esta capa recibe bonus extra.
    const criticalFirst = ["definition", "symptom", "treatment"] as const;
    let sequenceBonus = 0;
    for (const criticalLayer of criticalFirst) {
      if (layer === criticalLayer) {
        // Verificar si las ANTERIORES críticas están dominadas
        const myIdx = criticalFirst.indexOf(criticalLayer);
        const allPrevMastered = criticalFirst.slice(0, myIdx).every((p) => concept.layers[p]?.mastery >= 0.8);
        if (allPrevMastered) sequenceBonus = 0.6;
        break;
      }
    }

    return (knowledgeGap * 0.3 + decay * 0.2 + (importance - 1) * 0.2 + sequenceBonus) * importance;
  }

  /**
   * Actualiza la maestría de una capa tras una respuesta.
   * Usa un modelo bayesiano simple.
   */
  updateMastery(conceptId: string, layer: KnowledgeLayer, correct: boolean, confidence: number = 1): void {
    const concept = this.concepts.get(conceptId);
    if (!concept) {
      log.error(`updateMastery: concept no encontrado: ${conceptId}`, { operation: "kg.updateMastery" });
      return;
    }
    const l = concept.layers[layer];
    if (!l) {
      log.error(`updateMastery: layer no encontrado: ${layer} en concept ${conceptId}`, { operation: "kg.updateMastery" });
      return;
    }

    // BUG FIX: validar confidence en rango [0, 1]
    if (typeof confidence !== "number" || isNaN(confidence)) {
      log.error(`updateMastery: confidence inválida: ${confidence}, usando 1`, { operation: "kg.updateMastery" });
      confidence = 1;
    }
    if (confidence < 0 || confidence > 1) {
      log.warn(`updateMastery: confidence fuera de [0,1]: ${confidence} (clamping)`, { operation: "kg.updateMastery" });
      confidence = Math.max(0, Math.min(1, confidence));
    }

    const before = l.mastery;
    l.shown++;
    if (correct) {
      l.correct++;
      const delta = 0.1 * confidence;
      l.mastery = Math.min(1, l.mastery + delta);
    } else {
      l.incorrect++;
      const delta = 0.2 * confidence;
      l.mastery = Math.max(0, l.mastery - delta);
    }
    l.lastReviewed = Date.now();

    log.debug(
      `mastery ${conceptId}.${layer}: ${before.toFixed(2)} → ${l.mastery.toFixed(2)} (${correct ? "✓" : "✗"}, conf=${confidence})`,
      { operation: "kg.updateMastery", data: { conceptId, layer, before, after: l.mastery, correct, confidence } },
    );

    // Detección de anomalías
    if (l.mastery === 0 && l.correct > 0 && l.incorrect > 0) {
      log.anomaly("mastery_zero_with_mixed_results", l.mastery, 0.5, 0.5, { operation: "kg.updateMastery", data: { conceptId, layer } });
    }
  }

  /**
   * Marca una capa como "mostrada" sin afectar la maestría.
   * Útil cuando se genera una pregunta pero el usuario no respondió.
   */
  markShown(conceptId: string, layer: KnowledgeLayer): void {
    const concept = this.concepts.get(conceptId);
    if (!concept) return;
    const l = concept.layers[layer];
    if (!l) return;
    l.shown++;
    l.lastReviewed = Date.now();
  }

  /**
   * Estadísticas globales del knowledge graph.
   */
  stats(): {
    totalConcepts: number;
    totalLayers: number;
    averageMastery: number;
    knownLayers: number; // mastery >= 0.8
    weakLayers: number; // mastery < 0.5
  } {
    let totalLayers = 0;
    let sum = 0;
    let known = 0;
    let weak = 0;
    for (const c of this.concepts.values()) {
      for (const layer of LAYER_ORDER) {
        const l = c.layers[layer];
        if (!l) continue;
        totalLayers++;
        sum += l.mastery;
        if (l.mastery >= 0.8) known++;
        if (l.mastery < 0.5) weak++;
      }
    }
    return {
      totalConcepts: this.concepts.size,
      totalLayers,
      averageMastery: totalLayers > 0 ? sum / totalLayers : 0,
      knownLayers: known,
      weakLayers: weak,
    };
  }

  /** Serializa a JSON. */
  toJSON(): { concepts: KnowledgeConcept[] } {
    return { concepts: this.all() };
  }

  /** Carga desde JSON. */
  fromJSON(data: { concepts: KnowledgeConcept[] }): void {
    this.concepts.clear();
    this.conceptIndex.clear();
    for (const c of data.concepts) {
      this.add(c);
    }
  }
}

/** Helper: crea un concepto con todas las capas inicializadas. */
export function createConcept(
  id: string,
  term: string,
  opts: { aliases?: string[]; category?: string; tags?: string[]; sources?: KnowledgeConcept["sources"] } = {},
): KnowledgeConcept {
  const layers = {} as Record<KnowledgeLayer, ConceptLayer>;
  for (const layer of LAYER_ORDER) {
    layers[layer] = {
      layer,
      mastery: 0,
      lastReviewed: 0,
      correct: 0,
      incorrect: 0,
      shown: 0,
    };
  }
  return {
    id,
    term,
    aliases: opts.aliases ?? [],
    category: opts.category,
    tags: opts.tags ?? [],
    sources: opts.sources ?? [],
    layers,
    updatedAt: Date.now(),
  };
}
