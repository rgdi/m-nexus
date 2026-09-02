// v0.28: Repaso Libre (Free Review) — estudia lo que TÚ quieras, sin FSRS.
//
// Caso de uso: "Hoy me apetece repasar anatomía" — sin importar lo que diga
// el FSRS scheduler, sin dueDate, sin mastery, sin scheduling.
//
// Implementa:
//   1) Repaso por tema (e.g. "anatomía")
//   2) Repaso por carpeta (e.g. "anatomía/")
//   3) Repaso por tag (e.g. #cardio)
//   4) Repaso por concepto del knowledge graph
//   5) Repaso aleatorio
//   6) Repaso "todo lo que no he visto en N días"
//
// Las flashcards SE GUARDAN: la respuesta se persiste como review manual con
// la fecha actual, pero NO afectan al FSRS scheduler (no cambian dueDate/stability).

import type { FlashcardDraft, Rating } from "../types";
import { Logger } from "../utils/logger";
import { getBreadcrumbs } from "../utils/breadcrumbs";

const log = new Logger("free-review");

export type FreeReviewSource =
  | { type: "topic"; topic: string }                  // "anatomía"
  | { type: "folder"; folder: string }                // "anatomia/"
  | { type: "tag"; tag: string }                      // "#cardio"
  | { type: "concept"; conceptId: string }            // ID del knowledge graph
  | { type: "random"; count: number }                 // N flashcards aleatorias
  | { type: "stale"; days: number }                   // no vistas hace N días
  | { type: "all" }                                   // todas
  | { type: "custom"; cardIds: string[] };            // IDs específicos

export interface FreeReviewConfig {
  source: FreeReviewSource;
  /** Si se debe barajar. Default: true. */
  shuffle?: boolean;
  /** Número máximo de cards. Default: 50. */
  maxCards?: number;
  /** Si incluir cards ya dominadas (mastery >= 0.8). Default: true. */
  includeMastered?: boolean;
  /** Si se persiste la respuesta (afecta stats, no FSRS). Default: true. */
  persistAnswers?: boolean;
}

export interface FreeReviewSession {
  id: string;
  startedAt: number;
  source: FreeReviewSource;
  cards: FlashcardDraft[];
  currentIndex: number;
  responses: FreeReviewResponse[];
  completed: boolean;
}

export interface FreeReviewResponse {
  cardId: string;
  rating: Rating;
  timeMs: number;
  answeredAt: number;
}

export interface FreeReviewResult {
  total: number;
  correct: number;
  accuracy: number;
  averageTimeMs: number;
  durationMs: number;
  byRating: Record<Rating, number>;
}

/**
   Busca flashcards según el source especificado.
   Esta función es INTENCIONALMENTE simple — solo filtra.
   La fuente real de flashcards la inyecta el caller.
*/
export function findCardsForFreeReview(
  allCards: FlashcardDraft[],
  source: FreeReviewSource,
  config: { includeMastered?: boolean; maxCards?: number; shuffle?: boolean } = {},
): FlashcardDraft[] {
  const start = Date.now();
  log.info("Buscando cards para repaso libre", {
    operation: "free-review.find",
    data: { sourceType: source.type, totalCards: allCards.length },
  });

  let results: FlashcardDraft[] = [];

  switch (source.type) {
    case "topic": {
      const topic = source.topic.toLowerCase();
      results = allCards.filter((c) => {
        const notePath = c.notePath?.toLowerCase() ?? "";
        return notePath.includes(topic);
      });
      break;
    }
    case "folder": {
      const folder = source.folder.replace(/\/$/, "");
      results = allCards.filter((c) => (c.notePath ?? "").startsWith(folder));
      break;
    }
    case "tag": {
      const tag = source.tag.replace(/^#/, "").toLowerCase();
      results = allCards.filter((c) => (c.tags ?? []).some((t) => t.toLowerCase().replace(/^#/, "") === tag));
      break;
    }
    case "concept": {
      // El caller debe haber inyectado un mapping conceptId → cards
      // Aquí solo filtramos por tag matching el concept id
      results = allCards.filter((c) => (c.tags ?? []).includes(source.conceptId));
      break;
    }
    case "random": {
      results = shuffleArray([...allCards]).slice(0, source.count);
      break;
    }
    case "stale": {
      const cutoff = Date.now() - source.days * 24 * 3600_000;
      results = allCards.filter((c) => {
        const lastSeen = c.fsrs?.lastReview ? new Date(c.fsrs.lastReview).getTime() : 0;
        return lastSeen < cutoff;
      });
      break;
    }
    case "all": {
      results = [...allCards];
      break;
    }
    case "custom": {
      const ids = new Set(source.cardIds);
      results = allCards.filter((c) => ids.has(c.id));
      break;
    }
  }

  // Filtrar por mastery si aplica
  if (!config.includeMastered) {
    results = results.filter((c) => (c.fsrs?.stability ?? 0) < 21);
  }

  // Limitar
  const maxCards = config.maxCards ?? 50;
  if (results.length > maxCards) {
    if (config.shuffle !== false) {
      results = shuffleArray(results).slice(0, maxCards);
    } else {
      results = results.slice(0, maxCards);
    }
  } else if (config.shuffle !== false) {
    results = shuffleArray(results);
  }

  const durationMs = Date.now() - start;
  log.info(`Cards encontradas: ${results.length}`, {
    operation: "free-review.find",
    data: { sourceType: source.type, found: results.length, durationMs },
  });

  return results;
}

/** Crea una sesión de repaso. */
export function createFreeReviewSession(
  source: FreeReviewSource,
  cards: FlashcardDraft[],
): FreeReviewSession {
  const session: FreeReviewSession = {
    id: `frs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    startedAt: Date.now(),
    source,
    cards,
    currentIndex: 0,
    responses: [],
    completed: false,
  };
  getBreadcrumbs().record("state", "free-review", "Sesión creada", {
    data: { sessionId: session.id, cardCount: cards.length, source: source.type },
  });
  log.info(`Sesión de repaso libre creada: ${cards.length} cards`, {
    operation: "free-review.create",
    data: { sessionId: session.id, sourceType: source.type, cardCount: cards.length },
  });
  return session;
}

/** Registra una respuesta en la sesión. */
export function answerFreeReview(
  session: FreeReviewSession,
  cardId: string,
  rating: Rating,
  timeMs: number,
): FreeReviewSession {
  const response: FreeReviewResponse = {
    cardId,
    rating,
    timeMs,
    answeredAt: Date.now(),
  };
  session.responses.push(response);
  session.currentIndex++;

  log.debug(`Respuesta: cardId=${cardId} rating=${rating} time=${timeMs}ms`, {
    operation: "free-review.answer",
    data: { sessionId: session.id, cardId, rating, timeMs },
  });

  if (session.currentIndex >= session.cards.length) {
    session.completed = true;
    log.info("Sesión de repaso completada", {
      operation: "free-review.complete",
      data: { sessionId: session.id, totalAnswers: session.responses.length },
    });
  }
  return session;
}

/** Finaliza la sesión y devuelve el resultado. */
export function finishFreeReview(session: FreeReviewSession): FreeReviewResult {
  const total = session.responses.length;
  const correct = session.responses.filter((r) => r.rating >= 3).length;
  const totalTime = session.responses.reduce((s, r) => s + r.timeMs, 0);
  const byRating: Record<Rating, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of session.responses) byRating[r.rating]++;
  const result: FreeReviewResult = {
    total,
    correct,
    accuracy: total > 0 ? correct / total : 0,
    averageTimeMs: total > 0 ? totalTime / total : 0,
    durationMs: Date.now() - session.startedAt,
    byRating,
  };

  log.info("Resultado del repaso libre", {
    operation: "free-review.result",
    data: {
      sessionId: session.id,
      total,
      correct,
      accuracy: result.accuracy,
      durationMs: result.durationMs,
      byRating: { ...byRating },
    },
  });

  return result;
}

// ── Helpers ──

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Convierte un input libre ("anatomía", "anatomia/", "#cardio") en un FreeReviewSource. */
export function parseFreeReviewInput(input: string, count: number = 30): FreeReviewSource {
  const trimmed = input.trim();
  if (!trimmed) return { type: "all" };
  if (trimmed === "todas" || trimmed === "todo") return { type: "all" };
  if (trimmed === "aleatorio" || trimmed === "random") return { type: "random", count };
  if (trimmed.startsWith("#")) return { type: "tag", tag: trimmed };
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return { type: "folder", folder: trimmed };
  if (trimmed.startsWith("stale:") || trimmed.startsWith("hace ")) {
    const days = parseInt(trimmed.replace(/\D/g, ""), 10) || 30;
    return { type: "stale", days };
  }
  // Por defecto: topic
  return { type: "topic", topic: trimmed };
}

/** Convierte un FreeReviewSource a un string legible. */
export function describeFreeReviewSource(source: FreeReviewSource): string {
  switch (source.type) {
    case "topic": return `tema "${source.topic}"`;
    case "folder": return `carpeta "${source.folder}"`;
    case "tag": return `tag "${source.tag}"`;
    case "concept": return `concepto "${source.conceptId}"`;
    case "random": return `${source.count} aleatorias`;
    case "stale": return `sin ver hace ${source.days} días`;
    case "all": return "todas";
    case "custom": return `${source.cardIds.length} específicas`;
  }
}
