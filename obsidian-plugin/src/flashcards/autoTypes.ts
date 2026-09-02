// Auto-types: el LLM decide qué tipo de tarjeta (basic, cloze, reversed, list)
// generar para cada concepto. Esto permite que el sistema elija el formato
// más adecuado según el contenido, en lugar de forzar un tipo fijo.
//
// v0.5: con esto, un solo template genérico puede generar flashcards variadas.

import { CardType, FlashcardDraft, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";
import { LLMManager } from "../llm/manager";
import { FlashcardTemplate } from "../types";
import { parseLlmResponse } from "./parser";
import { TFile } from "obsidian";

const TYPE_DECISION_PROMPT = `Eres un asistente pedagógico. Dado un fragmento de nota, clasifica
el MEJOR tipo de flashcard a generar:

- "basic": definición simple, pregunta-respuesta directa
- "cloze": frase con término a ocultar (ideal para definiciones, mecanismos)
- "reversed": pares bidireccionales (idiomas, equivalencias, etc.)
- "list": enumeraciones, pasos secuenciales, cascadas
- "image-occlusion": solo si el fragmento describe una imagen/diagrama

Devuelve SOLO un JSON: {"cardType": "...", "reasoning": "..."}`;

/**
 * Pide al LLM que clasifique qué tipo de tarjeta es el más adecuado.
 * Si el LLM no está disponible, usa heurísticas locales.
 */
export async function detectBestCardType(
  llm: LLMManager,
  text: string,
  log: Logger
): Promise<CardType> {
  // Heurísticas locales rápidas (sin LLM)
  const local = localDetectType(text);
  if (!llm.isAvailable()) return local;

  // Si el LLM está disponible, le pregunta
  try {
    const provider = llm.getProvider();
    const res = await provider.complete(
      `${TYPE_DECISION_PROMPT}\n\nFragmento:\n${text.slice(0, 2000)}`,
      { temperature: 0.1, maxTokens: 200, responseFormat: "json" }
    );
    try {
      const parsed = JSON.parse(res) as { cardType?: string };
      const t = normalizeType(parsed.cardType);
      if (t) return t;
    } catch {
      /* malformed JSON, fall back to local */
    }
  } catch (e) {
    log.warn(`Auto-type LLM falló: ${(e as Error).message}. Usando heurística local.`);
  }
  return local;
}

export function localDetectType(text: string): CardType {
  const t = text.toLowerCase();
  // Cloze: detecta formato Anki {{c1::...}} PRIMERO (es muy específico)
  if (/\{\{c\d+::/.test(text)) {
    return "cloze";
  }
  // Lista / pasos (chequear PRIMERO porque "pasos" es muy específico)
  if (/\b(pasos?|secuencia|orden|primero|segundo|tercero|finalmente)\b/.test(t) ||
      /^\s*[\d\-\*]\s+.+$/m.test(text)) {
    return "list";
  }
  // Reversed: equivalencias bidireccionales (chequear ANTES que cloze
  // porque "equivale" también puede aparecer en una definición)
  if (/\b(equivalente|sinónimo|antónimo|opuesto|en inglés|en español|abreviatura|traducción)\b/.test(t)) {
    return "reversed";
  }
  // Cloze: definiciones
  if (/^\s*\*?\*?[A-ZÁÉÍÓÚÑ][\w\s]+\*?\*?\s*(es|son|se define|consiste|significa)/m.test(text)) {
    return "cloze";
  }
  // Default
  return "basic";
}

export function normalizeType(t?: string): CardType | null {
  if (!t) return null;
  const k = t.toLowerCase().trim();
  if (k.includes("cloze")) return "cloze";
  if (k.includes("reversed") || k.includes("reverso") || k.includes("bidireccional")) return "reversed";
  if (k.includes("list") || k.includes("lista") || k.includes("paso")) return "list";
  if (k.includes("image") || k.includes("imagen") || k.includes("occlusion")) return "image-occlusion";
  if (k.includes("freeform") || k.includes("libre")) return "freeform";
  if (k.includes("basic") || k.includes("pregunta") || k.includes("definición")) return "basic";
  return null;
}

/**
 * Enriquece los drafts con cardType sugerido por el LLM.
 * Si el LLM no está disponible, usa heurística local.
 */
export async function enrichDraftsWithAutoType(
  drafts: FlashcardDraft[],
  llm: LLMManager,
  log: Logger
): Promise<FlashcardDraft[]> {
  // Para velocidad, solo enriquecemos los primeros 15 (la mayoría de las
  // notas no tienen más) y solo si el LLM está disponible.
  if (!llm.isAvailable() || drafts.length === 0) {
    return drafts.map((d) => ({ ...d, cardType: d.cardType ?? "basic" }));
  }
  const limited = drafts.slice(0, 15);
  const rest = drafts.slice(15);
  const enriched = await Promise.all(
    limited.map(async (d) => {
      const t = await detectBestCardType(llm, d.front + "\n" + d.back, log);
      return { ...d, cardType: t };
    })
  );
  return [...enriched, ...rest.map((d) => ({ ...d, cardType: d.cardType ?? "basic" }))];
}
