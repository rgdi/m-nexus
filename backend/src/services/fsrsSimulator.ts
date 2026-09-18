// fsrsSimulator.ts — Day-by-day spaced-repetition simulator (v2.9.0).
//
// Given a deck of cards (with calibrated FSRS params from knowledgeDiagnostic),
// simulate N days of review sessions. At each day:
//   - Mark cards due today for review
//   - User grades them (passed in as a probability or sequence)
//   - Apply FSRS update to compute next due date
//   - Track retention, lapse count, daily load
//
// Output: per-day stats + overall retention curve + final card states.

import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade, Rating } from "ts-fsrs";
import type { DiagnosticResult } from "./knowledgeDiagnostic.js";

export interface SimCard {
  id: string;
  topicId: string;
  /** Starting state — if omitted, derived from diagnostic */
  card?: Card;
}

export interface SimDayInput {
  /** Day index (0-based). User reviews some cards. */
  dayIdx: number;
  /** Map of cardId → grade given on this day (1-4: Again/Hard/Good/Easy) */
  reviews?: Record<string, Grade>;
  /** If no reviews specified, simulated grades based on retention probability */
  simulatedRetention?: number;
}

export interface SimConfig {
  cards: SimCard[];
  /** Days to simulate */
  days: number;
  /** Per-day review queue (optional, otherwise generated) */
  dailyReviews?: SimDayInput[];
  /** Diagnostic for FSRS profile */
  diagnostic?: DiagnosticResult;
  /** Max reviews per day (user capacity) */
  maxDailyReviews?: number;
  /** Max new cards per day */
  maxNewPerDay?: number;
  /** Simulated retention rate for unguided days (0-1) */
  defaultRetention?: number;
  /** v2.10.0: optional seed for deterministic simulation (mulberry32 PRNG). */
  seed?: number;
}

export interface SimDayResult {
  dayIdx: number;
  date: string;
  reviews: number;
  newLearned: number;
  retention: number;
  cardsStillLearning: number;
}

export interface SimResult {
  days: SimDayResult[];
  finalStates: Array<{ id: string; stability: number; difficulty: number; dueDays: number; state: number }>;
  retentionCurve: number[];
  totalReviews: number;
  totalNewCards: number;
}

export function simulate(config: SimConfig): SimResult {
  const f = config.diagnostic?.fsrsProfile
    ? fsrs(generatorParameters({
        request_retention: config.diagnostic.fsrsProfile.desiredRetention,
        enable_short_term: true,
      }))
    : fsrs();

  // v2.10.0: deterministic mode — seeded RNG for reproducible results.
  // When seed is provided, Math.random is replaced by a mulberry32 PRNG.
  // Default (seed=undefined) keeps non-deterministic behavior for casual use.
  const seed = config.seed;
  let rng: () => number;
  if (typeof seed === "number") {
    let s = seed >>> 0;
    rng = () => {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  } else {
    rng = Math.random;
  }

  const startDate = new Date();
  const maxDaily = config.maxDailyReviews ?? 50;
  const maxNew = config.maxNewPerDay ?? 10;
  const defaultRetention = config.defaultRetention ?? 0.85;

  // Initialize cards
  const states: Card[] = config.cards.map((sc) => {
    if (sc.card) {
      // copy
      return { ...sc.card, due: sc.card.due || startDate };
    }
    const c = createEmptyCard(startDate);
    if (config.diagnostic?.fsrsProfile) {
      c.stability = config.diagnostic.fsrsProfile.initialStability;
      c.difficulty = config.diagnostic.fsrsProfile.initialDifficulty;
    }
    return c;
  });

  const days: SimDayResult[] = [];
  let totalReviews = 0;
  let totalNew = 0;
  let cardsStillLearning = 0;

  for (let d = 0; d < config.days; d++) {
    const dayDate = new Date(startDate);
    dayDate.setDate(startDate.getDate() + d);
    const dayStart = new Date(dayDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const reviewInput = config.dailyReviews?.[d];
    const forcedReviews = reviewInput?.reviews || {};

    // Introduce new cards (state 0 → state 1 after first review)
    let newCount = 0;
    if (d < Math.ceil(config.cards.length / maxNew)) {
      for (let i = 0; i < maxNew && (d * maxNew + i) < config.cards.length; i++) {
        const idx = d * maxNew + i;
        if (states[idx].state === 0 && !states[idx].last_review) {
          // First review: pass = state 1 (Learning→Review), fail = state 3 (Relearning)
          const grade = rng() < defaultRetention ? Rating.Good : Rating.Again;
          const result = f.next(states[idx], dayDate, grade);
          states[idx] = result.card;
          newCount++;
          totalReviews++;
        }
      }
      totalNew += newCount;
    }

    // Find due cards (cards already past initial learning)
    const dueIdx: number[] = [];
    for (let i = 0; i < states.length; i++) {
      if (states[i].state >= 1 && states[i].due <= dayStart) dueIdx.push(i);
    }
    const reviewsToday = Math.min(dueIdx.length, maxDaily);
    let reviewsCount = 0;

    for (let k = 0; k < reviewsToday; k++) {
      const idx = dueIdx[k];
      const cardId = config.cards[idx].id;
      let grade: Grade;
      if (forcedReviews[cardId] !== undefined) {
        grade = forcedReviews[cardId];
      } else {
        grade = rng() < defaultRetention ? Rating.Good : Rating.Again;
      }
      const result = f.next(states[idx], dayDate, grade);
      states[idx] = result.card;
      reviewsCount++;
      if (grade === Rating.Again) cardsStillLearning++;
    }
    totalReviews += reviewsCount;

    // Compute day retention: cards with state >= 2 (review/relearning) / total learned
    const learned = states.filter((c) => c.state >= 1).length;
    const inReview = states.filter((c) => c.state >= 2).length;
    const retention = learned > 0 ? inReview / learned : 0;

    days.push({
      dayIdx: d,
      date: dayDate.toISOString().slice(0, 10),
      reviews: reviewsCount,
      newLearned: newCount,
      retention,
      cardsStillLearning,
    });
  }

  const finalStates = states.map((c, i) => ({
    id: config.cards[i].id,
    stability: c.stability,
    difficulty: c.difficulty,
    dueDays: Math.max(0, Math.ceil((c.due.getTime() - startDate.getTime()) / 86400000)),
    state: c.state,
  }));

  const retentionCurve = days.map((d) => d.retention);

  return {
    days,
    finalStates,
    retentionCurve,
    totalReviews,
    totalNewCards: totalNew,
  };
}
