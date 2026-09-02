// v0.28: Onboarding contextual — tooltips y mensajes para reducir la curva de aprendizaje.
// Muestra ayuda relevante en el momento justo, no tutoriales largos.

import { App, Notice } from "obsidian";

interface Hint {
  id: string;
  title: string;
  body: string;
  /** Cuándo se muestra: 'once' (solo la primera vez) | 'always' (cada vez) | 'never' */
  frequency: "once" | "always" | "never";
  /** Si se vio alguna vez */
  shown?: boolean;
}

const HINTS: Hint[] = [
  {
    id: "open-quiz",
    title: "Quiz adaptativo",
    body: "Detecta automáticamente lo que NO sabes y te pregunta solo sobre eso. Capa por capa.",
    frequency: "once",
  },
  {
    id: "open-proposals",
    title: "Propuestas del agente",
    body: "La IA analiza tu vault y propone crear flashcards, añadir tags, resumir, etc. Tú apruebas antes de aplicar.",
    frequency: "once",
  },
  {
    id: "annotation-pencil",
    title: "Escribir con el lápiz",
    body: "Traza con el stylus: el plugin lo convierte a texto automáticamente (DeepSeek-OCR).",
    frequency: "once",
  },
  {
    id: "audio-class",
    title: "Detección automática de clase",
    body: "Al grabar audio durante una clase, el plugin detecta automáticamente a qué materia corresponde según tu horario.",
    frequency: "once",
  },
  {
    id: "knowledge-graph",
    title: "Mapa de conocimiento",
    body: "Pulsa aquí para ver tu temario y lagunas: 10 capas (definición, síntomas, tratamiento…).",
    frequency: "once",
  },
];

const STORAGE_KEY = "mnexus:onboarding:hints-shown";

/** Obtiene los hints ya mostrados desde localStorage. */
function getShownHints(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

/** Marca un hint como mostrado. */
function markShown(id: string): void {
  const shown = getShownHints();
  shown.add(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(shown)));
  } catch {
    // Ignorar errores de localStorage
  }
}

/** Muestra un hint como Notice (no modal intrusivo). */
export function showHint(id: string): void {
  const hint = HINTS.find((h) => h.id === id);
  if (!hint) return;
  if (hint.frequency === "never") return;
  if (hint.frequency === "once" && getShownHints().has(id)) return;
  new Notice(`💡 ${hint.title}: ${hint.body}`, 6000);
  markShown(id);
}

/** Resetea los hints (para testing o "ver todos de nuevo"). */
export function resetHints(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignorar
  }
}

/** Mensajes contextuales: comandos con atajo + descripción breve. */
export const COMMAND_HINTS: Record<string, { shortcut: string; description: string }> = {
  "mnexus-adaptive-quiz": {
    shortcut: "Ctrl+Shift+Q",
    description: "Quiz adaptativo: detecta lagunas capa por capa",
  },
  "mnexus-knowledge-stats": {
    shortcut: "Ctrl+Shift+K",
    description: "Ver tu mapa de conocimiento y lagunas",
  },
  "mnexus-annotation-toggle": {
    shortcut: "Ctrl+Shift+D",
    description: "Modo anotación: dibuja con stylus o ratón",
  },
  "mnexus-sticky-create": {
    shortcut: "Ctrl+Shift+S",
    description: "Crear post-it virtual en la nota",
  },
  "mnexus-show-proposals": {
    shortcut: "Ctrl+Shift+P",
    description: "Ver propuestas de la IA (flashcards, tags, resúmenes…)",
  },
  "mnexus-voice-recorder": {
    shortcut: "Ctrl+Shift+R",
    description: "Grabar nota de voz (transcripción automática)",
  },
};

/** Devuelve un hint legible para un comando. */
export function getCommandHint(commandId: string): string {
  const h = COMMAND_HINTS[commandId];
  if (!h) return "";
  return `${h.shortcut} · ${h.description}`;
}
