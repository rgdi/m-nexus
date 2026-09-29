// services/reviewScheduler.ts — v2.37.0
//
// Single source of truth for "a card was reviewed, now what?"
//
// v2.35.0 shipped POST /flashcards/:id/review with a hand-rolled ladder:
//
//     const ladder = [0, 1, 6, 15, 22];                 // days by rating
//     stability = stability * (rating >= 3 ? 1.6 : …)   // fixed multiplier
//
// That is not FSRS-7. It ignores difficulty, ignores the 19-parameter
// weight vector, ignores retrievability, and its stability curve is a
// constant factor regardless of how long the card had been retained.
// The UI labelled the numbers "FSRS-7" while this ran underneath.
//
// This module replaces the ladder with the real scheduler in
// services/fsrs7.ts, and adapts between the two representations:
//
//   Fsrs7Card     — the scheduler's shape (19-param model, elapsed, …)
//   FsrsCardState — the persisted shape (stability/difficulty/state/due/…)
//
// The persisted shape is kept as-is so existing cards and existing
// progress queries do not need a migration; the extra scheduler fields
// ride along inside `fsrs` as an optional `sched` block.

import { next as fsrs7Next, retrievability, DEFAULT_W } from "./fsrs7.js";
import type { Fsrs7Card, Fsrs7Schedule, Rating } from "./fsrs7.js";

const DAY = 86_400_000;

/** FSRS-7 keeps a "lapsed" state; the persisted type predates it. */
export type PersistedCardState = "new" | "learning" | "relearning" | "review";

/** Default desired retention. 0.9 is the FSRS default; the product
 *  default is slightly lower because the study screen is opt-in. */
export const DEFAULT_TARGET_RETENTION = 0.9;

export interface ReviewOutcome {
  /** Persisted FSRS state to write back onto the card. */
  fsrs: PersistedFsrsState;
  /** Days until the next review (0.01 ≈ relearning, always in the future). */
  intervalDays: number;
  /** Retrievability at the moment of review. */
  retrievability: number;
  /** True when this review was a lapse (rating 1 on a review-state card). */
  isLapse: boolean;
}

export interface PersistedFsrsState {
  stability: number;
  difficulty: number;
  state: PersistedCardState;
  reps: number;
  lapses: number;
  lastReview: number;
  due: number;
  retrievability: number;
  /** Scheduler bookkeeping, added in v2.37.0. */
  sched?: {
    elapsedDays: number;
    targetRetention: number;
    /** Set when the persisted state predates v2.37.0. */
    migrated?: boolean;
  };
}

/** Anything we might be handed: full, partial, legacy, or already
 *  round-tripped through the scheduler (which can emit "lapsed"). */
type MaybeFsrs = Partial<Omit<PersistedFsrsState, "state">> & {
  state?: PersistedCardState | Fsrs7Card["state"];
};

/**
 * Build the scheduler's card shape from whatever we have persisted.
 *
 * Legacy cards stored `stability: 0` and `state: "new"`. Feeding that
 * straight into the 19-param model produces division-by-zero-ish
 * intervals, so a stability of 0 is mapped to the model's own default
 * of 0.5 days and the state is normalised.
 */
export function toFsrs7Card(prev: MaybeFsrs | null | undefined, now: number): Fsrs7Card {
  const lastReview = typeof prev?.lastReview === "number" && prev.lastReview > 0 ? prev.lastReview : now;
  const elapsed = Math.max(0, (now - lastReview) / DAY);
  const stability = typeof prev?.stability === "number" && prev.stability > 0 ? prev.stability : 0.5;

  let state: Fsrs7Card["state"];
  switch (prev?.state) {
    case "review":
      state = "review";
      break;
    case "learning":
      state = "learning";
      break;
    case "relearning":
      state = "relearning";
      break;
    case "lapsed":
      state = "lapsed";
      break;
    default:
      // "new" — or a legacy card with no state at all.
      state = "new";
  }

  return {
    stability,
    difficulty: typeof prev?.difficulty === "number" && prev.difficulty > 0 ? prev.difficulty : 5,
    elapsed: prev?.state ? elapsed : 0,
    reps: typeof prev?.reps === "number" ? prev.reps : 0,
    lapses: typeof prev?.lapses === "number" ? prev.lapses : 0,
    state,
    lastReview,
    // The scheduler recomputes `due`; keep the old one only for shape.
    due: typeof prev?.due === "number" ? prev.due : now,
  };
}

/** Scheduler state → persisted state. `lapsed` folds into `relearning`. */
function toPersistedState(s: Fsrs7Card["state"]): PersistedCardState {
  if (s === "lapsed") return "relearning";
  if (s === "new" || s === "learning" || s === "relearning" || s === "review") return s;
  return "review";
}

/**
 * Schedule the next review for a card.
 *
 * @param prev  persisted FSRS state (may be a legacy/partial object)
 * @param rating 1..4 (Again, Hard, Good, Easy)
 * @param now   injectable for tests
 * @param targetRetention desired recall probability at review time
 */
export function scheduleReview(
  prev: MaybeFsrs | null | undefined,
  rating: Rating,
  now: number = Date.now(),
  targetRetention: number = DEFAULT_TARGET_RETENTION,
): ReviewOutcome {
  const legacy = !prev || typeof prev.state !== "string" || !((prev.stability ?? 0) > 0);
  const card = toFsrs7Card(prev, now);

  // A lapse is "Again" on a card that was already graduated. The model
  // only applies its post-lapse stability floor in this case.
  const isLapse = rating === 1 && (card.state === "review" || card.state === "lapsed");

  const r = retrievability(card, card.elapsed);
  const sched: Fsrs7Schedule = fsrs7Next(card, rating, {
    now,
    w: DEFAULT_W,
    applyPostLapseBoost: true,
    targetRetention,
  });

  // Guard: the model can return a 0-day interval for a hard new card.
  // Clamp so a card is never due in the past.
  const intervalDays = Math.max(0.01, sched.interval);
  const due = Math.max(now + 60_000, sched.due);

  return {
    fsrs: {
      stability: sched.newStability,
      difficulty: sched.newDifficulty,
      state: toPersistedState(sched.next.state),
      reps: sched.next.reps,
      lapses: sched.next.lapses,
      lastReview: now,
      due,
      retrievability: Number(r.toFixed(4)),
      sched: {
        elapsedDays: Number(card.elapsed.toFixed(4)),
        targetRetention,
        ...(legacy ? { migrated: true } : {}),
      },
    },
    intervalDays: Number(intervalDays.toFixed(4)),
    retrievability: Number(r.toFixed(4)),
    isLapse,
  };
}

/**
 * How many cards are due at `now`.
 *
 * The study screen's header stat ("3 deben repasar") is computed from
 * this, so it lives next to the scheduler rather than in the screen.
 */
export function isDue(fsrs: Partial<PersistedFsrsState> | null | undefined, now: number = Date.now()): boolean {
  if (!fsrs) return true; // never scheduled → new card, always available
  if (fsrs.state === "new") return true;
  if (typeof fsrs.due !== "number") return true;
  return fsrs.due <= now;
}

/**
 * Retention bucket for the review log: which decay band did this review
 * land in. Drives the "retención 96.7%" headline on the progress screen.
 */
export function retentionBucket(r: number): "high" | "good" | "low" {
  if (r >= 0.9) return "high";
  if (r >= 0.7) return "good";
  return "low";
}
