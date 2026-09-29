// tests/v237.test.ts — v2.37.0 review scheduler.
//
// Covers the bug that shipped in v2.35.0: POST /flashcards/:id/review
// used a hardcoded [0,1,6,15,22] day ladder instead of the FSRS-7 model,
// so the intervals the UI showed were not the ones the scheduler computed.

import { describe, it, expect } from "vitest";
import {
  scheduleReview,
  toFsrs7Card,
  isDue,
  retentionBucket,
  DEFAULT_TARGET_RETENTION,
  type PersistedFsrsState,
} from "../src/services/reviewScheduler.js";
import { retrievability } from "../src/services/fsrs7.js";

const DAY = 86_400_000;
const T0 = 1_760_000_000_000;

function card(over: Partial<PersistedFsrsState> = {}): PersistedFsrsState {
  return {
    stability: 0,
    difficulty: 5,
    state: "new",
    reps: 0,
    lapses: 0,
    lastReview: 0,
    due: T0,
    retrievability: 1,
    ...over,
  };
}

describe("reviewScheduler — legacy card migration", () => {
  it("treats a brand new card as state=new with zero elapsed", () => {
    const c = toFsrs7Card(card(), T0);
    expect(c.state).toBe("new");
    expect(c.elapsed).toBe(0);
  });

  it("maps stability 0 to the model default instead of dividing by zero", () => {
    const c = toFsrs7Card(card({ stability: 0 }), T0);
    expect(c.stability).toBe(0.5);
  });

  it("survives a null/partial state", () => {
    expect(() => toFsrs7Card(null, T0)).not.toThrow();
    expect(() => toFsrs7Card(undefined, T0)).not.toThrow();
    expect(() => toFsrs7Card({}, T0)).not.toThrow();
    expect(toFsrs7Card(null, T0).stability).toBe(0.5);
  });

  it("computes elapsed days from lastReview", () => {
    const c = toFsrs7Card(card({ lastReview: T0 - 10 * DAY, stability: 3 }), T0);
    expect(c.elapsed).toBeCloseTo(10, 3);
  });

  it("never produces negative elapsed for a future lastReview", () => {
    const c = toFsrs7Card(card({ lastReview: T0 + 5 * DAY }), T0);
    expect(c.elapsed).toBe(0);
  });

  it("flags a legacy card with the migrated marker", () => {
    const out = scheduleReview(card(), 3, T0);
    expect(out.fsrs.sched?.migrated).toBe(true);
  });

  it("does not flag a card that already has real state", () => {
    const out = scheduleReview(card({ state: "review", stability: 12, reps: 9 }), 3, T0);
    expect(out.fsrs.sched?.migrated).toBeUndefined();
  });
});

describe("reviewScheduler — intervals", () => {
  // A graduated card, reviewed after real elapsed time. A new card always
  // lands in the learning phase, where the interval is a fixed ~7 min
  // step regardless of the rating — so ordering has to be measured on a
  // review-state card, not a fresh one.
  const graduated = () => card({ state: "review", stability: 20, reps: 6, lastReview: T0 - 20 * DAY });

  it("orders intervals Easy > Good > Hard > Again", () => {
    const again = scheduleReview(graduated(), 1, T0);
    const hard = scheduleReview(graduated(), 2, T0);
    const good = scheduleReview(graduated(), 3, T0);
    const easy = scheduleReview(graduated(), 4, T0);

    expect(again.intervalDays).toBeLessThan(hard.intervalDays);
    expect(hard.intervalDays).toBeLessThan(good.intervalDays);
    expect(good.intervalDays).toBeLessThan(easy.intervalDays);
  });

  it("never schedules a card in the past", () => {
    for (const r of [1, 2, 3, 4] as const) {
      const out = scheduleReview(card(), r, T0);
      expect(out.fsrs.due).toBeGreaterThan(T0);
      expect(out.intervalDays).toBeGreaterThan(0);
    }
  });

  it("reps increments on every review", () => {
    let state = card();
    for (let i = 0; i < 3; i++) {
      state = scheduleReview(state, 3, T0).fsrs;
    }
    expect(state.reps).toBe(3);
  });

  it("counts a lapse on Again after graduation", () => {
    const graduated = card({ state: "review", stability: 20, reps: 5, lapses: 0 });
    const out = scheduleReview(graduated, 1, T0);
    expect(out.isLapse).toBe(true);
    expect(out.fsrs.lapses).toBe(1);
  });

  it("does not count a lapse on a new card rated Again", () => {
    const out = scheduleReview(card(), 1, T0);
    expect(out.isLapse).toBe(false);
    expect(out.fsrs.lapses).toBe(0);
  });

  it("a lapse lowers stability below where it was", () => {
    const graduated = card({ state: "review", stability: 25, reps: 8 });
    const out = scheduleReview(graduated, 1, T0);
    expect(out.fsrs.stability).toBeLessThan(25);
  });

  it("Easy grows stability faster than Hard", () => {
    const base = () => card({ state: "review", stability: 10, reps: 4, lastReview: T0 - 10 * DAY });
    const hard = scheduleReview(base(), 2, T0);
    const easy = scheduleReview(base(), 4, T0);
    expect(easy.fsrs.stability).toBeGreaterThan(hard.fsrs.stability);
  });

  it("Hard is a success, not a lapse", () => {
    // v2.37.0: the review branch tested `r < 3`, so "Difícil" took the
    // failure path and w[15] (the hard penalty) was unreachable.
    const out = scheduleReview(card({ state: "review", stability: 30, reps: 7, lastReview: T0 - 30 * DAY }), 2, T0);
    expect(out.isLapse).toBe(false);
    expect(out.fsrs.lapses).toBe(0);
    expect(out.fsrs.state).toBe("review");
    expect(out.fsrs.stability).toBeGreaterThan(30);
  });

  it("a same-instant repeat review does not inflate stability", () => {
    // R = 1 at t = 0, so the FSRS increment is exactly zero. This is the
    // model working, not a bug: re-reviewing immediately teaches nothing.
    const prev = card({ state: "review", stability: 25, reps: 5, lastReview: T0 });
    const out = scheduleReview(prev, 3, T0);
    expect(out.fsrs.stability).toBeCloseTo(25, 5);
  });

  it("grows stability when the card is actually reviewed late", () => {
    const prev = card({ state: "review", stability: 25, reps: 5, lastReview: T0 - 25 * DAY });
    const out = scheduleReview(prev, 3, T0);
    expect(out.fsrs.stability).toBeGreaterThan(25);
  });

  it("differs from the old hardcoded ladder", () => {
    // v2.35.0 returned exactly 6 days for Good on any card.
    const out = scheduleReview(card(), 3, T0);
    expect(out.intervalDays).not.toBe(6);
  });

  it("resists the fixed-multiplier hack: same rating, different prior state, different result", () => {
    // The old code multiplied stability by 1.6 for rating>=3 regardless
    // of state, so both of these would produce 16 days.
    const weak = scheduleReview(card({ state: "review", stability: 10, reps: 3, lastReview: T0 - 10 * DAY }), 3, T0);
    const strong = scheduleReview(card({ state: "review", stability: 40, reps: 30, lastReview: T0 - 40 * DAY }), 3, T0);
    expect(weak.intervalDays).not.toBeCloseTo(strong.intervalDays, 2);
  });
});

describe("reviewScheduler — retrievability + target retention", () => {
  it("records retrievability before the review", () => {
    const out = scheduleReview(card({ state: "review", stability: 10, lastReview: T0 - 10 * DAY }), 3, T0);
    const expected = retrievability(toFsrs7Card(card({ state: "review", stability: 10, lastReview: T0 - 10 * DAY }), T0), 10);
    expect(out.retrievability).toBeCloseTo(expected, 3);
  });

  it("retrievability decays as more time passes", () => {
    const soon = scheduleReview(card({ state: "review", stability: 10, lastReview: T0 - 1 * DAY }), 3, T0);
    const later = scheduleReview(card({ state: "review", stability: 10, lastReview: T0 - 30 * DAY }), 3, T0);
    expect(later.retrievability).toBeLessThan(soon.retrievability);
  });

  it("stays within 0..1", () => {
    for (const r of [1, 2, 3, 4] as const) {
      const out = scheduleReview(card(), r, T0);
      expect(out.retrievability).toBeGreaterThanOrEqual(0);
      expect(out.retrievability).toBeLessThanOrEqual(1);
    }
  });

  it("a higher target retention yields a shorter interval", () => {
    const base = () => card({ state: "review", stability: 15, reps: 6, lastReview: T0 - 15 * DAY });
    const lax = scheduleReview(base(), 3, T0, 0.8);
    const strict = scheduleReview(base(), 3, T0, 0.95);
    expect(strict.intervalDays).toBeLessThan(lax.intervalDays);
  });

  it("persists the target retention used", () => {
    const out = scheduleReview(card(), 3, T0, 0.85);
    expect(out.fsrs.sched?.targetRetention).toBe(0.85);
  });

  it("defaults to 0.9", () => {
    expect(DEFAULT_TARGET_RETENTION).toBe(0.9);
    expect(scheduleReview(card(), 3, T0).fsrs.sched?.targetRetention).toBe(0.9);
  });
});

describe("reviewScheduler — isDue", () => {
  it("treats a new card as always due", () => {
    expect(isDue(card({ state: "new" }), T0)).toBe(true);
  });

  it("treats a missing state as due", () => {
    expect(isDue(null, T0)).toBe(true);
    expect(isDue(undefined, T0)).toBe(true);
    expect(isDue({}, T0)).toBe(true);
  });

  it("is not due before the due timestamp", () => {
    expect(isDue(card({ state: "review", due: T0 + 5 * DAY }), T0)).toBe(false);
  });

  it("is due at the due timestamp", () => {
    expect(isDue(card({ state: "review", due: T0 }), T0)).toBe(true);
  });

  it("is due after the due timestamp", () => {
    expect(isDue(card({ state: "review", due: T0 - DAY }), T0)).toBe(true);
  });

  it("a scheduled card is not immediately due again", () => {
    const out = scheduleReview(card(), 3, T0);
    expect(isDue(out.fsrs, T0)).toBe(false);
  });
});

describe("reviewScheduler — retention buckets", () => {
  it("classifies high/good/low", () => {
    expect(retentionBucket(0.95)).toBe("high");
    expect(retentionBucket(0.9)).toBe("high");
    expect(retentionBucket(0.8)).toBe("good");
    expect(retentionBucket(0.7)).toBe("good");
    expect(retentionBucket(0.3)).toBe("low");
    expect(retentionBucket(0)).toBe("low");
  });
});

describe("reviewScheduler — 20-review simulation", () => {
  it("keeps state coherent across a long run", () => {
    let state = card();
    let now = T0;
    for (let i = 0; i < 20; i++) {
      const out = scheduleReview(state, ((i % 4) + 1) as 1 | 2 | 3 | 4, now);
      state = out.fsrs;
      now = state.due; // come back when it is actually due
      expect(state.reps).toBe(i + 1);
      expect(state.stability).toBeGreaterThan(0);
      expect(state.difficulty).toBeGreaterThanOrEqual(1);
      expect(state.difficulty).toBeLessThanOrEqual(10);
      expect(state.due).toBeGreaterThanOrEqual(now);
    }
  });

  it("grows stability overall when the learner mostly succeeds", () => {
    let state = card();
    let now = T0;
    const first = scheduleReview(card(), 3, T0).fsrs.stability;
    for (let i = 0; i < 15; i++) {
      const out = scheduleReview(state, 3, now);
      state = out.fsrs;
      now = state.due;
    }
    expect(state.stability).toBeGreaterThan(first);
  });

  it("never schedules an interval beyond the 100-year cap", () => {
    let state = card();
    let now = T0;
    for (let i = 0; i < 30; i++) {
      const out = scheduleReview(state, 4, now);
      state = out.fsrs;
      now = state.due;
      expect(out.intervalDays).toBeLessThanOrEqual(36500);
    }
  });
});
