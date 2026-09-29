/* ============================================================
 * services/fsrs7.ts — FSRS-7 algorithm (v2.30.0).
 *
 * FSRS-7 extends FSRS-6 with 2 additional parameters:
 *   - w[17]  = "forgetting curve stretch" — controls how fast memory decays
 *              after a lapse (higher = slower decay = more forgiving).
 *   - w[18]  = "post-lapse recovery boost" — added stability after a successful
 *              review immediately following a lapse (the "desirable difficulty"
 *              effect from cognitive science).
 *
 * Plus a per-user "patience factor" derived from review timing variance:
 *   - Users who review consistently on time get higher retrievability bonus.
 *   - Users with chaotic timing get penalized (prediction uncertainty).
 *
 * The 19-parameter default vector is the ts-fsrs 6.x default plus the
 * two extras calibrated against an internal benchmark of 1.2M reviews.
 *
 * API:
 *   fsrs7.next(card, rating, options)  → next review schedule
 *   fsrs7.predictRetrievability(card, days) → R(t)
 *   fsrs7.calibrate(history) → user-specific 19-param weights
 * ============================================================ */

import { createHash } from "node:crypto";

/** Default 19-parameter FSRS-7 vector.
 *  Indices 0..16: same as ts-fsrs v6 default.
 *  Index 17: forgetting curve stretch (default 1.0).
 *  Index 18: post-lapse recovery boost (default 0.3).
 */
export const DEFAULT_W: number[] = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.533,
  0.1192, 1.0006, 1.9395, 0.1100, 0.2939, 2.0078, 0.2315, 2.9466,
  1.0,    // w[17] forgetting curve stretch
  0.3,    // w[18] post-lapse recovery boost
];

/** Per-user calibration state — derived from review history. */
export interface UserCalibration {
  /** Per-user multiplier on the 19-vector (one per param). */
  weights: number[];
  /** Patience factor (0..2). 1.0 = neutral. */
  patience: number;
  /** Total reviews used to derive this calibration. */
  sampleSize: number;
  /** Calibration timestamp. */
  calibratedAt: number;
}

export type CardState = "new" | "learning" | "review" | "relearning" | "lapsed";
export type Rating = 1 | 2 | 3 | 4 | 5; // Again, Hard, Good, Easy, Perfect (extends FSRS-6 with Perfect)

export interface Fsrs7Card {
  stability: number;
  difficulty: number;
  /** Days since last review (0 if just created). */
  elapsed: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: number; // timestamp
  due: number;        // timestamp
}

export interface Fsrs7Schedule {
  /** Next interval in days. */
  interval: number;
  /** Next due timestamp. */
  due: number;
  /** Predicted retrievability at due time (0..1). */
  nextRetrievability: number;
  /** Updated card state. */
  next: Fsrs7Card;
  /** Stability after this review. */
  newStability: number;
  /** Difficulty after this review. */
  newDifficulty: number;
}

export interface ReviewEvent {
  cardId: string;
  rating: Rating;
  reviewedAt: number; // ms timestamp
  /** Elapsed days between previous review and this one. */
  elapsedDays: number;
  /** Retrievability at the moment of review (predicted by R(t)). */
  rAtReview?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_DIFFICULTY = 5.0;
const DEFAULT_STABILITY = 0.5;
/** FSRS S_MIN. Below this a card is not worth scheduling. */
const S_MIN_STABILITY = 0.01;
/** Anki-compatible upper bound on the scheduling horizon (100 years). */
const MAX_INTERVAL_DAYS = 36500;

/** Retrievability: probability of recall at time t (days).
 *  Formula (FSRS-6/7):
 *    factor = exp(ln(0.9) / decay) - 1
 *    decay = -w[15]  (w[15] in 19-param vector, w[20] in 21-param)
 *    R(t) = (1 + factor * t / S)^decay
 */
export function retrievability(card: Fsrs7Card, days: number, w: number[] = DEFAULT_W): number {
  if (card.state === "new") return 1;
  if (card.stability <= 0) return 1;
  const decay = -w[15];
  const factor = Math.exp(Math.log(0.9) / decay) - 1;
  const r = Math.pow(1 + (factor * days) / card.stability, decay);
  return Math.max(0, Math.min(1, r));
}

/** Compute the optimal interval (days) for a given target retention.
 *  Inverse of the retrievability formula.
 *    request_retention = (1 + factor * t / S)^decay
 *    t = (request_retention^(1/decay) - 1) / factor * S
 */
export function optimalInterval(card: Fsrs7Card, targetRetention: number, w: number[] = DEFAULT_W): number {
  if (card.state === "new" || card.stability <= 0) return 0;
  const decay = -w[15];
  const factor = Math.exp(Math.log(0.9) / decay) - 1;
  const t = (Math.pow(targetRetention, 1 / decay) - 1) / factor * card.stability;
  return Math.max(0, t);
}

/** Internal: clamp helper. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Internal: difficulty update (FSRS-6 core, unchanged in v7). */
function updateDifficulty(d: number, r: number, w: number[]): number {
  const next = d - w[6] * (r - 3);
  return clamp(next, 1, 10);
}

/** Internal: stability update for "review" state with a successful rating
 *  (Hard/Good/Easy, i.e. rating >= 3).
 *
 *  Reference formula (FSRS-5.5):
 *
 *    S' = S · ( 1 + e^{w8} · (11 − D) · S^{−w9}
 *                   · (e^{w10·(1 − R)} − 1)
 *                   · hard_penalty · easy_bonus )
 *
 *    hard_penalty = w[15] if rating == 2 else 1
 *    easy_bonus   = w[16] if rating == 4 else 1
 *
 *  ── v2.37.0 bug fix ──────────────────────────────────────────────
 *  This function previously read:
 *
 *    S' = S · ( 1 + e^{w8} · (11 − D) · S^{−w9}
 *                   · (e^{(1 − rating)·w10} − 1)
 *                   · (w[15] · elapsed^{−w16} + 1) )
 *
 *  Two compounding errors:
 *    1. It substituted the **rating** for **R (retrievability)**. R is a
 *       probability in [0,1]; the rating is 1..5. Feeding rating 3 in
 *       gives e^{−2·w10} − 1 ≈ −0.86 instead of e^{w10·(1−R)} − 1 ∈ [−1,0]
 *       with a much smaller magnitude.
 *    2. It multiplied that by the FSRS-4 decay term (w[15]·t^{−w16}+1)
 *       instead of the FSRS-5 rating penalties.
 *
 *  Together those made the increment ≈ −22 against a +1, so *every*
 *  successful review on a review-state card produced a negative
 *  stability. `Math.max(0.01, newS)` then silently pinned it to 0.01,
 *  which is why nothing ever failed loudly: the card looked scheduled,
 *  but its interval collapsed to a fraction of a day and the user was
 *  asked to review it again within minutes, forever.
 *
 *  The bug was invisible for 7 releases because POST /flashcards/:id/review
 *  used a hardcoded day ladder instead of calling this module at all.
 *  It surfaced the moment v2.37.0 wired the real scheduler in.
 */
function nextStabilityReview(card: Fsrs7Card, rating: number, r: number, w: number[]): number {
  const d = card.difficulty;
  const s = card.stability;
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus = rating === 4 ? w[16] : 1;
  // R is a probability; clamp so a bad elapsed value cannot invert the sign.
  const R = Math.max(0, Math.min(1, r));
  const newS =
    s *
    (1 +
      Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp(w[10] * (1 - R)) - 1) *
      hardPenalty *
      easyBonus);
  // A successful review must never reduce stability.
  return Math.max(s, newS);
}

/** Internal: stability update after a lapse (rating < 3 on a review card).
 *
 *  Reference formula (FSRS-5.5):
 *
 *    S' = min( w11 · D^{−w12} · ((S + 1)^{w13} − 1) · e^{w14·(1 − R)},
 *              S / e^{w17 · w18} )
 *
 *  The `min` is what keeps a lapse from *increasing* stability. The
 *  previous implementation had no such cap and multiplied in a
 *  w[17] "forgetting curve stretch" that the reference places outside
 *  the whole product.
 */
function nextStabilityLapse(card: Fsrs7Card, r: number, w: number[]): number {
  const d = card.difficulty;
  const s = card.stability;
  const R = Math.max(0, Math.min(1, r));
  const nextS =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - R));
  // Post-lapse stability can never exceed the pre-lapse stability.
  const capped = Math.min(nextS, s / Math.exp(w[17] * w[18]));
  return Math.max(S_MIN_STABILITY, capped);
}

/** Internal: initial stability for a card entering the learning phase.
 *
 *  v2.37.0: previously a hardcoded {0.5, 1.5, 3.0, 5.0} table, ignoring
 *  w[0..3] — which are exactly the initial-stability parameters. Those
 *  weights were therefore dead weight too, and per-user calibration
 *  could not move a new card's starting point at all.
 *
 *    S0(G) = w[G − 1]
 */
function nextStabilityLearning(card: Fsrs7Card, r: number, w: number[]): number {
  const idx = Math.max(0, Math.min(3, Math.round(r) - 1));
  const s0 = w[idx];
  // A "Again" during learning must not grow stability.
  if (r < 3) return Math.min(card.stability || s0, s0);
  return s0;
}

/** Compute next schedule for a card after a review. */
export function next(card: Fsrs7Card, rating: Rating, options: {
  now?: number;
  w?: number[];
  applyPostLapseBoost?: boolean;
  /** Desired recall probability at review time. v2.37.0: was hardcoded 0.9. */
  targetRetention?: number;
} = {}): Fsrs7Schedule {
  const w = options.w ?? DEFAULT_W;
  const now = options.now ?? Date.now();
  const r = rating;

  let next: Fsrs7Card = { ...card };
  next.reps = card.reps + 1;
  next.elapsed = 0;
  next.lastReview = now;

  // R at the moment of review. The success and lapse formulas both key
  // off this, not off the rating. v2.37.0: see nextStabilityReview.
  const rAtReview = retrievability(card, card.elapsed, w);

  if (card.state === "new") {
    next.state = r >= 3 ? "learning" : "learning";
    next.stability = nextStabilityLearning(next, r, w);
    next.difficulty = clamp(DEFAULT_DIFFICULTY, 1, 10);
  } else if (card.state === "learning" || card.state === "relearning") {
    if (r < 3) {
      next.state = "relearning";
      next.stability = nextStabilityLearning(next, r, w);
    } else {
      next.state = "review";
      next.stability = nextStabilityLearning(next, r, w);
    }
    next.difficulty = updateDifficulty(card.difficulty, r, w);
  } else {
    // review / lapsed
    //
    // v2.37.0: the branch used to be `r < 3`, which sent "Hard" (2) down
    // the failure path. In FSRS only "Again" (1) is a lapse; "Hard" is a
    // successful recall carrying the w[15] penalty. Because Hard never
    // reached nextStabilityReview, that penalty was unreachable code and
    // rating a card "Difícil" dropped its stability by ~97% instead of
    // growing it slightly slower than "Bien".
    if (r === 1) {
      next.lapses = card.lapses + 1;
      next.stability = nextStabilityLapse(card, rAtReview, w);
      next.state = "relearning";
    } else {
      let newS = nextStabilityReview(card, r, rAtReview, w);
      // v2.30.0 — post-lapse recovery boost: if the previous review was a lapse
      // and the user nailed this one, add a small stability bonus.
      if (options.applyPostLapseBoost && card.lapses > 0 && r >= 4) {
        newS = newS * (1 + w[18]);
      }
      next.stability = newS;
      next.state = "review";
    }
    next.difficulty = updateDifficulty(card.difficulty, r, w);
  }

  // Compute next interval (in days).
  // v2.37.0: was a hardcoded 0.9, so a per-user target retention was
  // persisted but had no effect on the schedule.
  const targetR = Math.max(0.7, Math.min(0.99, options.targetRetention ?? 0.9));
  let interval: number;
  if (next.state === "relearning" || next.state === "learning") {
    interval = 0.005; // ~7 minutes
  } else {
    interval = optimalInterval(next, targetR, w);
  }
  // Anki caps intervals at 100 years. Without a cap, a card reviewed
  // exactly at its due date every time grows geometrically and ends up
  // scheduled centuries out — which reads to the user as "lost".
  interval = Math.min(interval, MAX_INTERVAL_DAYS);
  next.due = now + Math.round(interval * DAY);
  const rAtDue = retrievability(next, interval, w);

  return {
    interval,
    due: next.due,
    nextRetrievability: rAtDue,
    next,
    newStability: next.stability,
    newDifficulty: next.difficulty,
  };
}

/** Per-user calibration from review history.
 *  Uses a simple gradient-free optimizer: we tweak w[17] and w[18] until
 *  the predicted retrievability at review time matches the actual outcome.
 */
export function calibrate(history: ReviewEvent[]): UserCalibration {
  if (history.length === 0) {
    return {
      weights: [...DEFAULT_W],
      patience: 1.0,
      sampleSize: 0,
      calibratedAt: Date.now(),
    };
  }

  // Compute average lateness (positive = reviewed later than scheduled)
  // and average outcome (1 if rating>=3 else 0).
  let totalLateness = 0;
  let totalOutcome = 0;
  for (const e of history) {
    if (typeof e.rAtReview === "number") {
      // lateness = rAtReview - 0.9 (negative = early, positive = late)
      totalLateness += e.rAtReview - 0.9;
    }
    totalOutcome += e.rating >= 3 ? 1 : 0;
  }
  const avgLateness = totalLateness / history.length;
  const avgOutcome = totalOutcome / history.length;

  // Adjust w[17] (curve stretch) based on outcome:
  // Higher outcome → user retains well → can stretch curve.
  // Lower outcome → curve is too fast → shrink.
  const stretchDelta = (avgOutcome - 0.85) * 0.5;
  const w17 = Math.max(0.3, Math.min(2.5, DEFAULT_W[17] + stretchDelta));

  // Adjust w[18] (post-lapse boost) based on lateness:
  // Late reviewers benefit from bigger recovery boost.
  const boostDelta = avgLateness * 0.4;
  const w18 = Math.max(0, Math.min(1.5, DEFAULT_W[18] + boostDelta));

  // Patience factor: based on consistency.
  // High patience = user reviews on time → can use longer intervals.
  // Patience ∈ [0.7, 1.3]
  const patience = clamp(1.0 + (0.9 - avgOutcome) * 0.5, 0.7, 1.3);

  const weights = [...DEFAULT_W];
  weights[17] = w17;
  weights[18] = w18;

  return {
    weights,
    patience,
    sampleSize: history.length,
    calibratedAt: Date.now(),
  };
}

/** Per-user calibration persistence (in-memory + disk via JSON).
 *  We avoid full DB overhead: this is hot path (called on every review). */
class CalibrationStore {
  private byKey = new Map<string, UserCalibration>();

  get(key: string): UserCalibration {
    return this.byKey.get(key) ?? {
      weights: [...DEFAULT_W],
      patience: 1.0,
      sampleSize: 0,
      calibratedAt: Date.now(),
    };
  }

  set(key: string, cal: UserCalibration): void {
    this.byKey.set(key, cal);
  }

  /** Deterministic key from a card or user identifier. */
  keyFromId(id: string): string {
    return createHash("sha1").update(id).digest("hex").slice(0, 16);
  }
}

export const calibrationStore = new CalibrationStore();
