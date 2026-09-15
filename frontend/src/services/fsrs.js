/* ============================================================
 * fsrs.js — Free Spaced Repetition Scheduler (FSRS-4.5)
 * v1.7.0 — implementation cliente-side, sin dependencias.
 *
 * Referencia: https://github.com/open-spaced-repetition/fsrs4anki
 * Implementación simplificada con 4 ratings: Again(1)/Hard(2)/Good(3)/Easy(4)
 *
 * Modelo por flashcard:
 *   { stability (D in days), difficulty (D in [1..10]), lastReview (ms), due (ms), reps }
 *
 * Para el MVP usamos los 17 parámetros por defecto de FSRS-4.5:
 *   w = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651,
 *        0.0589, 1.748,  0.2133, 1.2896, 1.5954, 0.105,  1.2542,
 *        0.0751, 1.7751, 4.1587]
 *   decay = -0.5
 *   factor = 19/81 = 0.234567...
 *   requestRetention = 0.9 (por defecto)
 * ============================================================ */

const W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.748, 0.2133, 1.2896, 1.5954, 0.105, 1.2542, 0.0751, 1.7751, 4.1587];
const DECAY = -0.5;
const FACTOR = 0.2345679012345679; // 19/81
const REQUEST_RETENTION = 0.9;
const DAY_MS = 86400 * 1000;

/** Inicializa un card state nuevo. */
export function initCard() {
  const now = Date.now();
  return { stability: 0, difficulty: 0, lastReview: 0, due: now, reps: 0, lapses: 0, state: "new" };
}

/** Retrievability — probabilidad de recordar en `elapsed` días. */
function forgettingCurve(elapsedDays, stability) {
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

/** Stability After Success — actualiza S para rating q. */
function nextStabilitySuccess(d, s, r, rating) {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  const newS = s * (1 + Math.exp(W[8]) *
    (11 - d) *
    Math.pow(s, -W[9]) *
    (Math.exp((1 - r) * W[10]) - 1) *
    hardPenalty *
    easyBonus);
  return Math.max(0.01, newS);
}

/** Stability After Lapse (Again) */
function nextStabilityLapse(d, s, r) {
  const newS = W[11] *
    Math.pow(d, -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp((1 - r) * W[14]);
  return Math.max(0.01, newS);
}

/** Next difficulty based on rating */
function nextDifficulty(d, rating) {
  const delta = rating === 1 ? -W[6] : rating === 2 ? -W[5] : rating === 3 ? 0 : W[4];
  const newD = d + delta * (10 - d) / 9;
  return clamp(newD, 1, 10);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function meanRevalidation(s) { return s; }

/**
 * Review — devuelve el siguiente state y la retrievability.
 * @param card {stability, difficulty, lastReview, due, reps, state}
 * @param rating 1=Again, 2=Hard, 3=Good, 4=Easy
 */
export function review(card, rating, now = Date.now()) {
  const elapsedDays = Math.max(0, (now - (card.lastReview || now)) / DAY_MS);
  const r = forgettingCurve(elapsedDays, card.stability || 0.01);

  let newS, newD, newState;
  if (rating === 1) {
    // Again → lapse
    newS = nextStabilityLapse(card.difficulty || 5, card.stability || 1, r);
    newD = clamp((card.difficulty || 5) - W[6] * (10 - (card.difficulty || 5)) / 9, 1, 10);
    newState = card.reps >= 1 ? "relearning" : "learning";
  } else {
    // Hard/Good/Easy
    newD = nextDifficulty(card.difficulty || 5, rating);
    newS = nextStabilitySuccess(newD, card.stability || 1, r, rating);
    newState = card.state === "new" || card.state === "learning" ? "review" : "review";
  }
  // Interval (días) → ms. Use FSRS optimal interval from stability
  const optimalDays = nextInterval(newS);
  const due = now + optimalDays * DAY_MS;
  const reps = card.reps + 1;
  const lapses = card.lapses + (rating === 1 ? 1 : 0);

  return {
    stability: newS,
    difficulty: newD,
    lastReview: now,
    due,
    reps,
    lapses,
    state: newState,
    retrievability: r,
    intervalDays: optimalDays,
  };
}

/** Calcula el próximo intervalo (días) dada la stability. */
function nextInterval(s) {
  // Invertimos la curva del olvido para r = requestRetention
  // r = (1 + factor * I / s)^decay  →  I = s / factor * (r^(1/decay) - 1)
  const exponent = 1 / DECAY; // -2
  const I = s / FACTOR * (Math.pow(REQUEST_RETENTION, exponent) - 1);
  return clamp(I, 1, 365);
}

/** Devuelve cards ordenadas por prioridad de revisión. */
export function prioritize(cards) {
  const now = Date.now();
  return cards
    .map((c) => ({
      ...c,
      fsrs: c.fsrs || initCard(),
      overdueDays: (now - (c.fsrs?.due || now)) / DAY_MS,
    }))
    .filter((c) => (c.fsrs?.due ?? 0) <= now + DAY_MS * 1) // due en 24h
    .sort((a, b) => (a.fsrs?.due ?? 0) - (b.fsrs?.due ?? 0));
}

/** Snapshot para debug */
export function debug(card) {
  return {
    stability: card.stability?.toFixed(2),
    difficulty: card.difficulty?.toFixed(2),
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    due: new Date(card.due).toLocaleString(),
  };
}

export const FSRS_RATINGS = {
  again: { value: 1, label: "Again", color: "#dc2626", shortcut: "1" },
  hard:  { value: 2, label: "Hard",  color: "#d97706", shortcut: "2" },
  good:  { value: 3, label: "Good",  color: "#16a34a", shortcut: "3" },
  easy:  { value: 4, label: "Easy",  color: "#2563eb", shortcut: "4" },
};
