// Templates de flashcards built-in (v0.5: SIMPLIFICADOS).
//
// Filosofía: el usuario debe poder usar el plugin sin configurar nada.
// Estos 5 templates cubren los casos más comunes. El usuario puede
// crear los suyos desde el panel de templates.
//
// v0.5: el LLM ahora RECOMIENDA el tipo de tarjeta apropiado para cada
// fragmento de contenido (ver autoTypes.ts). Los templates son sugerencias,
// no reglas estrictas.

import { FlashcardTemplate } from "../types";

export const BUILTIN_TEMPLATES: FlashcardTemplate[] = [
  // ─── GENÉRICO (por defecto) ──────────────────────────────────────────
  {
    id: "generic-auto",
    name: "Genérico (LLM decide)",
    subject: "general",
    description: "Deja que el LLM elija el mejor tipo de tarjeta (pregunta, cloze, lista, etc.) según el contenido.",
    cardType: "basic",
    systemPrompt: `Eres un profesor que crea flashcards de alta calidad para estudio activo.
Para cada concepto, decide el MEJOR tipo de tarjeta:
- "basic"      → pregunta-respuesta directa
- "cloze"      → frase con un término a ocultar (usa {{c1::término}})
- "reversed"   → preguntable en ambas direcciones (A↔B)
- "list"       → enumeración o pasos en orden
- "image-occlusion" → solo si hay una imagen específica

Reglas:
- Preguntas claras, autocontenidas, sin ambigüedad.
- Respuestas precisas, máximo 2-3 frases.
- Cada flashcard debe poder responderse en <30 segundos.
- Devuelve JSON array con {front, back, cardType, tags}.`,
    userPrompt: `Nota: {{noteTitle}}
Materia: {{subject}}

Contenido:
{{noteContent}}

Genera hasta 10 flashcards eligiendo el mejor tipo por contenido.`,
    parserStrategy: "json",
    parserConfig: {
      jsonExample: '[{"front":"...","back":"...","cardType":"basic|cloze|reversed|list","tags":["..."]}]',
    },
    localFallback: "definitions",
    autoTags: [],
    examples: [
      { front: "¿Qué es la homeostasis?", back: "Mantenimiento de las condiciones internas del organismo dentro de un rango estable." },
    ],
    builtin: true,
  },

  // ─── CONCEPTUAL ──────────────────────────────────────────────────────
  {
    id: "conceptual",
    name: "Conceptual (pregunta → respuesta)",
    subject: "general",
    description: "Flashcards clásicas de pregunta y respuesta. Para definiciones y conceptos.",
    cardType: "basic",
    systemPrompt: `Crea flashcards de pregunta-respuesta.
- Preguntas claras y específicas.
- Respuestas de 1-2 frases.
- Devuelve JSON: {front, back, tags}.`,
    userPrompt: `Nota: {{noteTitle}}

{{noteContent}}

Genera hasta 10 flashcards pregunta-respuesta sobre los conceptos clave.`,
    parserStrategy: "json",
    parserConfig: {
      jsonExample: '[{"front":"...","back":"...","tags":["..."]}]',
    },
    localFallback: "definitions",
    autoTags: [],
    examples: [],
    builtin: true,
  },

  // ─── CLOZE ──────────────────────────────────────────────────────────
  {
    id: "cloze",
    name: "Cloze (rellenar huecos)",
    subject: "general",
    description: "Frases con términos a ocultar. Útil para definiciones, mecanismos, etc.",
    cardType: "cloze",
    systemPrompt: `Crea flashcards cloze.
- Usa {{c1::término}} para ocultar el término que se debe recordar.
- Puedes usar c1, c2, c3... para múltiples ocultamientos.
- El "front" contiene la frase con cloze; el "back" la frase completa.
- Devuelve JSON: {front, back, tags}.`,
    userPrompt: `Nota: {{noteTitle}}

{{noteContent}}

Genera hasta 10 frases cloze sobre los conceptos importantes.`,
    parserStrategy: "json",
    parserConfig: {
      jsonExample: '[{"front":"La arteria {{c1::mesentérica superior}} irriga...","back":"La arteria mesentérica superior irriga...","tags":["..."]}]',
    },
    localFallback: "headings",
    autoTags: [],
    examples: [
      { front: "El nervio {{c1::frénico}} inerva el {{c2::diafragma}}.", back: "El nervio frénico inerva el diafragma." },
    ],
    builtin: true,
  },

  // ─── LISTA / PASOS ──────────────────────────────────────────────────
  {
    id: "list-steps",
    name: "Lista / Pasos",
    subject: "general",
    description: "Para enumeraciones, cascadas, mecanismos paso a paso.",
    cardType: "list",
    systemPrompt: `Crea flashcards de tipo lista.
- Una lista por flashcard.
- Numerada si son pasos secuenciales.
- La respuesta incluye todos los items.
- Devuelve JSON: {front, back, tags}.`,
    userPrompt: `Nota: {{noteTitle}}

{{noteContent}}

Genera hasta 8 flashcards de tipo lista/pasos sobre las enumeraciones, cascadas o mecanismos mencionados.`,
    parserStrategy: "json",
    parserConfig: {
      jsonExample: '[{"front":"Enumera los pasos de...","back":"1) ...\\n2) ...\\n3) ...","tags":["..."]}]',
    },
    localFallback: "lists",
    autoTags: [],
    examples: [],
    builtin: true,
  },

  // ─── RESUMEN BREVE ───────────────────────────────────────────────────
  {
    id: "summary",
    name: "Resumen breve",
    subject: "general",
    description: "Genera 3-5 flashcards de resumen rápido por nota. Ideal para repaso general.",
    cardType: "basic",
    systemPrompt: `Crea un RESUMEN muy breve (3-5 tarjetas) sobre el contenido.
- Cada flashcard cubre UN aspecto clave.
- Respuestas de máximo 2 frases.
- Pensado para repaso rápido previo a examen.
- Devuelve JSON: {front, back, tags}.`,
    userPrompt: `Nota: {{noteTitle}}

{{noteContent}}

Genera 3-5 flashcards de resumen rápido.`,
    parserStrategy: "json",
    parserConfig: {
      jsonExample: '[{"front":"...","back":"...","tags":["resumen"]}]',
    },
    localFallback: "headings",
    autoTags: ["resumen"],
    examples: [],
    builtin: true,
  },
];

export const DEFAULT_TEMPLATE_ID = "generic-auto";
