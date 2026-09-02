// LevelInjector: compone el system prompt final con el bloque de nivel académico.
// Se usa en RAG, viñetas y modo socrático.

import { AcademicLevel, LLMMessage } from "../types";
import { getLevelInfo } from "./taxonomy";

export interface InjectedContext {
  level: AcademicLevel;
  systemBlock: string;
  userPreamble: string;
}

/**
 * Devuelve el bloque de nivel académico listo para añadir al system prompt.
 * Si levelAware=false o el nivel es "custom" sin prompt, devuelve bloque vacío.
 */
export function buildLevelBlock(level: AcademicLevel, levelAware: boolean): string {
  if (!levelAware) return "";
  const info = getLevelInfo(level);
  if (!info.prompt) return "";
  return info.prompt;
}

/**
 * Inyecta el nivel en una lista de mensajes (los del LLM).
 * - El primer system message recibe el bloque.
 * - Si no hay system message, se crea uno al inicio.
 */
export function injectLevel(messages: LLMMessage[], level: AcademicLevel, levelAware: boolean): LLMMessage[] {
  const block = buildLevelBlock(level, levelAware);
  if (!block) return messages;
  const out = [...messages];
  if (out.length > 0 && out[0].role === "system") {
    out[0] = { ...out[0], content: out[0].content + "\n\n" + block };
  } else {
    out.unshift({ role: "system", content: block });
  }
  return out;
}

/**
 * Devuelve el contexto inyectado (útil para tests y debug).
 */
export function buildInjectedContext(level: AcademicLevel, levelAware: boolean): InjectedContext {
  const info = getLevelInfo(level);
  return {
    level,
    systemBlock: buildLevelBlock(level, levelAware),
    userPreamble: `Nivel académico activo: ${info.label}. Vocabulario esperado: ${info.vocabulary.slice(0, 5).join(", ")}.`,
  };
}

/**
 * Enriquece el prompt del usuario con un prefijo de nivel (opcional).
 * Útil cuando el provider no soporta systemPrompt separado.
 */
export function prependLevelToUser(prompt: string, level: AcademicLevel, levelAware: boolean): string {
  if (!levelAware) return prompt;
  const info = getLevelInfo(level);
  if (info.id === "custom") return prompt;
  return `[${info.label}]\n\n${prompt}`;
}
