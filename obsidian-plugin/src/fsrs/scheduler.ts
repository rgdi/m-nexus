// ⚠️ DEPRECATED v0.28: Esta lógica se ejecuta en el backend.
// El plugin debe usar src/services/aiClient.ts en su lugar.
// Esta implementación se mantiene solo como fallback offline y para tests.
// Migrar a backend: import { backendEvalVault, backendGenerateProposals, etc. } from './services/aiClient';
// Implementación del algoritmo FSRS v5 (Free Spaced Repetition Scheduler).
// Referencia: open-spaced-repetition / ts-fsrs.
//
// Cada tarjeta tiene: { stability, difficulty, dueDate, reps, lapses, lastReview, lastRating }.
// Después de una review con rating 1..4, se recalculan S y D y se programa la próxima.
// S = estabilidad (días que la memoria aguanta con R ≈ 90% por defecto).
// D = dificultad (1..10).
// R = probabilidad de recuerdo actual = (1 + t/(9*S))^(-1).

// Pesos del FSRS v5 (referencia: ts-fsrs)
// w[0]  = w[0]  initial stability for Again
// w[1]  = w[1]  initial stability for Hard
// w[2]  = w[2]  initial stability for Good
// w[3]  = w[3]  initial stability for Easy
// w[4]  = w[4]  difficulty D0(mean reversion)
// w[5]  = w[5]  weights[4] (D update)
// w[6]  = w[6]  weights[5] (D update)
// w[7]  = w[7]  mean reversion for S
// w[8]  = w[8]  S growth factor
// w[9]  = w[9]  S growth power
// w[10] = w[10] S growth power 2
// w[11] = w[11] lapse S reset factor
// w[12] = w[12] lapse D power
// w[13] = w[13] lapse D factor
// w[14] = w[14] lapse S power
// w[15] = w[15] hard penalty
// w[16] = w[16] easy bonus
const W = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.5330, 0.1192, 1.0006, 1.9395, 0.1100, 0.2939, 2.0078, 0.2315, 2.9466,
];

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export interface FsrsCard {
  stability: number;
  difficulty: number;
  dueDate: Date;
  reps: number;
  lapses: number;
  lastReview?: Date;
  lastRating?: Rating;
}

export interface FsrsReviewResult {
  card: FsrsCard;
  /** Intervalo en días hasta la próxima review. */
  intervalDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inicializa una tarjeta nueva con valores neutros. */
export function newCard(): FsrsCard {
  // Las cards nuevas se programan para MAÑANA, no hoy, para evitar
  // que aparezcan en repasos inmediatamente al ser creadas.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return {
    stability: 1,
    difficulty: 5,
    dueDate: tomorrow,
    reps: 0,
    lapses: 0,
  };
}

/** R(t, S) = (1 + t/(9*S))^(-1). */
export function retrievability(tDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + tDays / (9 * stability), -1);
}

/** Próximo intervalo (en días) manteniendo la retención objetivo. */
export function nextInterval(stability: number, requestRetention = 0.9): number {
  // De R = (1 + I/(9*S))^(-1) = r → I = 9*S*(1/r - 1)
  const iv = 9 * stability * (1 / requestRetention - 1);
  return Math.max(1, Math.round(iv * 10) / 10);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** Aplica una review y devuelve el nuevo estado. */
export function review(card: FsrsCard, rating: Rating, requestRetention = 0.9): FsrsReviewResult {
  // Validaciones
  if (!card || typeof card !== "object") {
    throw new TypeError("review: card inválida");
  }
  if (rating < 1 || rating > 4) {
    throw new RangeError(`review: rating inválida: ${rating} (debe ser 1-4)`);
  }
  if (requestRetention <= 0 || requestRetention > 1) {
    throw new RangeError(`review: requestRetention fuera de (0,1]: ${requestRetention}`);
  }
  if (card.stability < 0) {
    throw new RangeError(`review: stability negativa: ${card.stability}`);
  }
  if (card.difficulty < 1 || card.difficulty > 10) {
    throw new RangeError(`review: difficulty fuera de [1,10]: ${card.difficulty}`);
  }

  const now = new Date();
  const elapsedDays = card.lastReview
    ? Math.max(0, (now.getTime() - card.lastReview.getTime()) / DAY_MS)
    : 0;
  const r = retrievability(elapsedDays, card.stability);

  let { stability: s, difficulty: d } = card;
  let newLapses = card.lapses;

  if (rating === 1) {
    newLapses += 1;
    s = W[11] * Math.pow(d, -W[12]) * (Math.exp(W[13] * (1 - r)) - 1) * (Math.pow(s + 1, W[14]) - 1);
    if (!isFinite(s) || isNaN(s)) {
      s = 0.1;
    }
    s = Math.max(0.1, s);
    d = clamp(d + W[6] * (3 - 3), 1, 10);
    s = Math.max(s, W[2]);
  } else {
    const hardPenalty = rating === 2 ? W[15] : 1;
    const easyBonus = rating === 4 ? W[16] : 1;
    const increment = Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hardPenalty * easyBonus;
    if (!isFinite(increment) || isNaN(increment)) {
      // Anomalía: incremento no finito, posiblemente r > 1 o s < 0
      s = s;
    } else {
      s = s * (1 + increment);
    }
    d = clamp(d - W[6] * (rating - 3), 1, 10);
    s = clamp(s, 0.1, 36500);
  }

  if (card.reps === 0) {
    s = W[rating - 1];
  }

  let intervalDays = nextInterval(s, requestRetention);
  if (!isFinite(intervalDays) || isNaN(intervalDays) || intervalDays < 1) {
    // BUG FIX: dueDate inválida. Forzar mínimo 1 día
    intervalDays = 1;
  }
  const due = new Date(now.getTime() + intervalDays * DAY_MS);

  return {
    card: {
      stability: round2(s),
      difficulty: round2(d),
      dueDate: due,
      reps: card.reps + 1,
      lapses: newLapses,
      lastReview: now,
      lastRating: rating,
    },
    intervalDays,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
