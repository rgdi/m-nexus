/* ============================================================
 * fsrs_v6.js — bridge al FSRS-6 backend (v2.24.0).
 *
 * Antes (v1.7–v2.23): FSRS-4.5 cliente-side, persistido en localStorage.
 * Ahora (v2.24.0): el backend ya corre FSRS-6 real con `ts-fsrs`.
 *   - Si el backend responde: srcapelo de su respuesta. La card persistirá
 *     en backend tras la migración del schema.
 *   - Si está offline: caemos a FSRS-4.5 cliente-side para que el user no
 *     pierda la sesión (nunca se pierde trabajo).
 *
 * El modelo por card es:
 *   { stability, difficulty, lastReview, due, reps, lapses, state, retrievability }
 *
 * + Interleaving opcional (§3.4 del paper): si interleave=true, encola
 *   también N cards hermanas del mismo interleaveGroup para discriminación.
 * + Elaboración activa (§3.5): si la respuesta fue "Again", prompt
 *   "¿por qué fallaste? ¿cómo se relaciona con X?" → persistido en
 *   `elaborations[]` (campo del Flashcard en backend).
 * ============================================================ */

import { review as clientReview, initCard as clientInitCard } from "./fsrs.js"; // FSRS-4.5 fallback

const BACKEND_HINT = "fsrs-v6";
const FALLBACK_ALGO = "fsrs-v5"; // backend keyword: v4.5 == v5 in our FSRS naming

/**
 * Procesa rating de una card. Devuelve el nuevo state + algo de telemetría.
 *
 * @param cardSnapshot {Object} frontend state con stability/difficulty/...
 * @param rating 1=Again 2=Hard 3=Good 4=Easy
 * @param opts.backendReview (id, userId, algo) — recibe promesa del backend
 *        Si no se provee o el backend falla → fallback cliente.
 * @returns {nextState, algo, latencyMs, source: "backend"|"client"}
 */
export async function applyRating(cardSnapshot, rating, opts) {
  const t0 = performance.now();
  const card = cardSnapshot.fsrs || clientInitCard();

  if (opts?.backendReview) {
    try {
      const res = await opts.backendReview();
      if (res && res.cards && res.cards[0]?.newState) {
        return {
          nextState: res.cards[0].newState,
          algo: BACKEND_HINT,
          latencyMs: Math.round(performance.now() - t0),
          source: "backend",
        };
      }
    } catch (e) {
      console.warn("[fsrs_v6] backend review failed; falling back to client", e?.message || e);
    }
  }
  // Fallback cliente (FSRS-4.5)
  const next = clientReview(card, rating);
  return {
    nextState: next,
    algo: FALLBACK_ALGO,
    latencyMs: Math.round(performance.now() - t0),
    source: "client",
  };
}

/** Mapear review fsrs del backend (objeto Card de ts-fsrs) a nuestro shape FSRS-6. */
export function normalizeBackendState(card) {
  return {
    stability: card.stability ?? 0,
    difficulty: card.difficulty ?? 5,
    state: card.state ?? "new",
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    lastReview: card.last_review
      ? new Date(card.last_review).getTime()
      : Date.now(),
    due: card.due ? new Date(card.due).getTime() : Date.now(),
    retrievability: typeof card.retrievability === "number" ? card.retrievability : 1,
  };
}
