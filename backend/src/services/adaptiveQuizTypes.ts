// Adaptive quiz: types & constants.

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

