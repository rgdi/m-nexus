// services/cognitiveValidator.ts — reglas de diseño de tarjetas basadas en evidencia.
//
// Paper "Ciencia de la Memoria para Estudiantes de Medicina y Carreras Exigentes"
// §6 (Diseño de flashcards), §6.2 (Reglas adicionales) y §6.3 (Errores frecuentes).
//
// Tres capas de validación:
//   1. atomicSplit(): 1 hecho = 1 cloze. Detecta mega-tarjetas (cloze con múltiples ::)
//   2. validateCard(): reglas heurísticas simples (front limpio, back corto, etc.)
//   3. suggestCardType(): heurística para inferir el mejor cardType
//
// Naveja de Ockham: cada regla es barata, no añade infra, devuelve
// { ok: boolean; warnings: string[]; suggestion?: string }.

import type { CardType } from "../routes/flashcards.js";

export interface CardValidationResult {
  ok: boolean;
  warnings: string[];
  /** Si la card viola reglas duras (mega-tarjeta, front==back) → hard reject. */
  hardError?: string;
  /** Sugerencia opcional: por ejemplo dividir la card en dos. */
  suggestion?: string;
}

// Reglas extraídas del paper §6.2:
//   1. Cara frontal: 1 pregunta, 1 respuesta correcta.
//   2. Reverso: respuesta corta, 1-3 frases.
//   3. Contexto, no solo definición.
//   4. Imágenes cuando aporten.
//   5. Bidireccional cuando aplique.
const MAX_FRONT_WORDS = 12;     // §6.2 regla 1: 1 pregunta
const MAX_BACK_WORDS = 50;      // §6.2 regla 2: 1-3 frases (≈ 50 palabras)
const FRONT_BACK_MIN_RATIO = 0.4; // §6.3 "Usar la respuesta como pregunta": back no puede ser ~front

/**
 * Detecta "mega-tarjetas" de cloze (Wozniak + paper §6.3): una cloze con
 * varios :: separadores indica múltiples respuestas en la misma card.
 *
 * Ejemplo mega-tarjeta:
 *   "¿Causas de pancreatitis? :: alcohol :: colelitiasis :: hipertrigliceridemia"
 *   → front: ¿Causas de pancreatitis?, back: alcohol, colelitiasis, hipertrigliceridemia
 *
 * Ejemplo atómica OK:
 *   "¿Cuál es el gen mutado en fibrosis quística? :: CFTR"
 *   → sólo una respuesta por cloze.
 */
export function looksLikeMegaCard(front: string, back: string): boolean {
  // Si el BACK trae elementos en lista que parecen "Causas:" (2+ items separados por , o ;),
  // y la front hace una pregunta tipo "Causas de X", eso es mega-tarjeta.
  const isListQuestion = /^[\s¡¿]*\s*\d*\.?\s*[¿¡]?\s*(?:[Cc]ausas?|síntomas?|diagn[oó]sticos?|diferenciales?|factores?|[Cc]riterios?|[Mm]ecanismos?|[Tt]ipos?|[Ff]ases?)\b/i.test(
    front.trim(),
  );
  const LIST_SEPARATORS = /(?:\s+y\s+)|(?:[,;]\s+)|(?=\b[A-Z]\.\s+)/;
  const listItems = (back || "")
    .split(LIST_SEPARATORS)
    .map((s) => s.trim().replace(/^[A-Z]\.\s+/, ""))
    .map((s) => s.trim())
    .filter(Boolean);
  if (isListQuestion && listItems.length >= 2 && listItems.length <= 12) return true;
  // También si el front trae "::" (mega-inline cloze) — cada :: extra mete
  // un ítem separado en la misma card.
  const frontClozes = (front.match(/\{\{c\d+::/g) ?? []).length;
  if (frontClozes >= 2) return true;
  return false;
}

/**
 * Sugiere las cards atómicas en las que dividir una mega-tarjeta.
 * Devuelve un array de pares {front, back} extraídos ordenadamente.
 */
export function splitMegaCard(
  front: string,
  back: string,
): Array<{ front: string; back: string }> {
  const trimmed = front.trim();
  // Caso 1: lista en el back separada por , o " y ".
  // Detect list separators: ", ", "; ", " y ", or letter-prefixed items like "A. Foo B. Bar"
const listSeparators = /(?:\s+y\s+)|(?:[,;]\s+)|(?=\b[A-Z]\.\s+)/;
const list = (back || "")
    .split(listSeparators)
    .map((s) => s.trim().replace(/^[A-Z]\.\s+/, ""))
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length >= 2) {
    // Re-phrasing: convierte pregunta tipo "Causas de X?" en tarjetas
    // individuales "¿Cuál es una causa de X? → Y"
    const stems: Record<string, string> = {
      Causas: "¿Cuál es una causa de",
      causa: "¿Cuál es una causa de",
      Síntomas: "¿Cuál es un síntoma de",
      síntomas: "¿Cuál es un síntoma de",
      Diagnósticos: "¿Cuál es un diagnóstico diferencial de",
      Diferenciales: "¿Cuál es un diagnóstico diferencial de",
      Factores: "¿Cuál es un factor de",
      Criterios: "¿Cuál es un criterio de",
    };
    const head = trimmed.replace(/\?$/, "").toLowerCase();
    const stem = Object.entries(stems).find(([k]) => head.startsWith(k.toLowerCase()))?.[1];
    if (stem) {
      return list.map((item) => ({
        front: `${stem} ${trimmed} → ${item}`,
        back: item,
      }));
    }
    // fallback: una card por ítem con la pregunta original como front
    return list.map((item) => ({
      front: trimmed,
      back: item,
    }));
  }
  // Si front lleva varios {{c ::}} inline, extrae cada uno
  const m = [...front.matchAll(/\{\{c\d+::([^}:]+?)(?:::([^}]*))?\}\}/g)];
  if (m.length >= 2) {
    return m.map((hit) => ({
      front: front.replace(hit[0], "_____"),
      back: hit[1].trim(),
    }));
  }
  // No hay patrón claro → return original como única card.
  return [{ front, back }];
}

/** Reglas heurísticas (paper §6.2 + §6.3). */
export function validateCard(
  front: string,
  back: string,
  cardType?: CardType,
): CardValidationResult {
  const warnings: string[] = [];
  if (!front || !back) {
    return { ok: false, warnings: [], hardError: "front y back requeridos" };
  }

  // Mega-tarjeta → hard error
  if (looksLikeMegaCard(front, back)) {
    const split = splitMegaCard(front, back);
    return {
      ok: false,
      warnings: [],
      hardError: `Mega-tarjeta detectada (${split.length} hechos mezclados).`,
      suggestion: `Dividir en ${split.length} tarjetas atómicas. Preview: ${split
        .map((s) => `"${s.front.slice(0, 30)}…"`)
        .join(" | ")}`,
    };
  }

  const frontW = countWords(front);
  const backW = countWords(back);

  if (frontW > MAX_FRONT_WORDS) {
    warnings.push(
      `Front largo (${frontW} palabras). Wozniak p.11: 1 pregunta corta por card.`,
    );
  }
  if (backW > MAX_BACK_WORDS) {
    warnings.push(
      `Back largo (${backW} palabras). Paper §6.2 regla 2: reverso 1-3 frases, ideal <30 palabras.`,
    );
  }
  if (front.trim() === back.trim()) {
    return {
      ok: false,
      warnings,
      hardError: "Front y back idénticos (paper §6.3: 'Usar la respuesta como pregunta').",
    };
  }
  // Bidireccionalidad: si son ~iguales en longitud, probablemente la front es la respuesta
  if (backW < FRONT_BACK_MIN_RATIO * frontW) {
    warnings.push(
      "Back demasiado corto respecto a front. Paper §6.2 regla 1: front = pregunta, back = respuesta.",
    );
  }
  // Cloze sin contexto (§6.2 regla 3)
  if (cardType === "cloze" || /\{\{c\d+::/.test(front) || /\{\{c\d+::/.test(back)) {
    const totalChars = (front + " " + back).length;
    if (totalChars < 30) {
      warnings.push(
        "Cloze sin contexto suficiente (<30 caracteres). Paper §6.2 regla 3: 'contexto, no solo definición'.",
      );
    }
  }
  // Suggest type when not explicit
  let suggestion: string | undefined;
  if (!cardType) {
    suggestion = `cardType recomendado: ${suggestCardType(front, back)}`;
  }

  return { ok: true, warnings, suggestion };
}

function countWords(s: string): number {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Heurística para inferir cardType. Reglas (paper §6.1):
 *   - cloze: lleva {{c1::…}} o el texto es una frase con un elemento central
 *   - enumerate: front termina en `:`, back es lista numerada
 *   - image_occlusion: front sólo es una URL / placeholder
 *   - basic: el resto (Q limpia / A corta)
 */
export function suggestCardType(front: string, back: string): CardType {
  if (/\{\{c\d+::/.test(front) || /\{\{c\d+::/.test(back)) return "cloze";
  if (/^https?:\/\//.test(front.trim())) return "image_occlusion";
  if (/^\s*$/.test(front.trim()) === false && /^\s*$/.test(back.trim()) === false) {
    const listLines = (back || "").split(/\n/).filter((l) => /^\s*\d+[\.\)]/.test(l));
    if (listLines.length >= 2) return "enumerate";
  }
  return "basic";
}

/**
 * Atomiza una lista de flashcards candidatas aplicando las reglas y devolviendo:
 *   - accepted: las que pasan la validación
 *   - split:   pares (original → nuevas) cuando la card original era mega
 *   - rejected: cards que no pasan reglas duras y no son divisibles
 */
export interface AtomicRefactorResult {
  accepted: Array<{
    front: string;
    back: string;
    cardType: CardType;
    warnings: string[];
  }>;
  split: Array<{
    originalFront: string;
    split: Array<{ front: string; back: string; cardType: CardType }>;
  }>;
  rejected: Array<{
    front: string;
    back: string;
    reason: string;
  }>;
}

export function atomicRefactor(
  candidates: Array<{ front: string; back: string; cardType?: CardType }>,
): AtomicRefactorResult {
  const accepted: AtomicRefactorResult["accepted"] = [];
  const split: AtomicRefactorResult["split"] = [];
  const rejected: AtomicRefactorResult["rejected"] = [];
  for (const c of candidates) {
    const v = validateCard(c.front, c.back, c.cardType);
    if (v.ok) {
      accepted.push({
        front: c.front,
        back: c.back,
        cardType: c.cardType ?? suggestCardType(c.front, c.back),
        warnings: v.warnings,
      });
      continue;
    }
    if (v.hardError && (looksLikeMegaCard(c.front, c.back) || c.front.trim() !== c.back.trim())) {
      const subs = splitMegaCard(c.front, c.back);
      if (subs.length >= 2) {
        split.push({
          originalFront: c.front,
          split: subs.map((s) => ({
            front: s.front,
            back: s.back,
            cardType: suggestCardType(s.front, s.back),
          })),
        });
        continue;
      }
    }
    rejected.push({ front: c.front, back: c.back, reason: v.hardError ?? "regla heurística" });
  }
  return { accepted, split, rejected };
}
