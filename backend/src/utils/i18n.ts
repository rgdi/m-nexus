// i18n.ts: sistema simple de internacionalización para mensajes del backend.
//
// v0.46: el backend retorna códigos de error (EC-XXX-NNN) que el frontend
// traduce. Pero los logs internos y mensajes de validación pueden venir
// en el idioma del usuario. Este módulo provee traducciones para los
// mensajes más comunes.

type Locale = "en" | "es" | "pt";

const messages: Record<string, Record<Locale, string>> = {
  // Genéricos
  "errors.required": {
    en: "Field is required",
    es: "El campo es obligatorio",
    pt: "O campo é obrigatório",
  },
  "errors.invalid": {
    en: "Invalid value",
    es: "Valor inválido",
    pt: "Valor inválido",
  },
  "errors.unauthorized": {
    en: "Unauthorized",
    es: "No autorizado",
    pt: "Não autorizado",
  },
  "errors.not_found": {
    en: "Not found",
    es: "No encontrado",
    pt: "Não encontrado",
  },
  "errors.rate_limit": {
    en: "Too many requests",
    es: "Demasiadas solicitudes",
    pt: "Muitas solicitações",
  },

  // FSRS
  "fsrs.eval.queued": {
    en: "FSRS evaluation queued",
    es: "Evaluación FSRS encolada",
    pt: "Avaliação FSRS na fila",
  },
  "fsrs.eval.invalid_rating": {
    en: "Rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)",
    es: "Rating debe ser 1 (Again), 2 (Hard), 3 (Good), o 4 (Easy)",
    pt: "Rating deve ser 1 (Again), 2 (Hard), 3 (Good) ou 4 (Easy)",
  },

  // Proposals
  "proposals.llm_unavailable": {
    en: "LLM unavailable, using heuristic fallback",
    es: "LLM no disponible, usando fallback heurístico",
    pt: "LLM indisponível, usando fallback heurístico",
  },
  "proposals.llm_invalid_json": {
    en: "LLM returned invalid JSON",
    es: "LLM devolvió JSON inválido",
    pt: "LLM retornou JSON inválido",
  },
};

/** Detecta el locale preferido del header Accept-Language. */
export function detectLocale(acceptLanguage?: string): Locale {
  if (!acceptLanguage) return "en";
  const lc = acceptLanguage.toLowerCase();
  if (lc.startsWith("es")) return "es";
  if (lc.startsWith("pt")) return "pt";
  return "en";
}

/** Traduce un mensaje al locale dado, con fallback a inglés. */
export function t(key: string, locale: Locale = "en"): string {
  const msg = messages[key];
  if (!msg) return key; // fallback: retornar la key
  return msg[locale] ?? msg.en ?? key;
}

/** Helper para crear AppError con mensaje localizado. */
export function localizedMessage(key: string, locale: Locale = "en", context?: Record<string, unknown>): { message: string; context?: Record<string, unknown> } {
  return { message: t(key, locale), context };
}

export type { Locale };
