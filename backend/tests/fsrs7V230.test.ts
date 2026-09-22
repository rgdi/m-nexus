// fsrs7V230.test.ts — v2.30.0 FSRS-7 + predictive scheduler tests.

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_W,
  retrievability,
  optimalInterval,
  calibrate,
  calibrationStore,
  next,
  type Fsrs7Card,
  type ReviewEvent,
} from "../src/services/fsrs7.js";
import {
  predictCard,
  predictBatch,
  timeToTargetR,
  optimalWindow,
  riskHeatmap,
} from "../src/services/predictiveScheduler.js";

function card(over: Partial<Fsrs7Card> = {}): Fsrs7Card {
  return {
    stability: 2,
    difficulty: 5,
    elapsed: 0,
    reps: 1,
    lapses: 0,
    state: "review",
    lastReview: 0,
    due: 0,
    ...over,
  };
}

describe("v2.30.0 — fsrs7 retrievability", () => {
  it("R(t=0) = 1 for any non-new card", () => {
    const c = card();
    expect(retrievability(c, 0)).toBeCloseTo(1, 5);
  });

  it("R(t→∞) → 0 monotonically", () => {
    const c = card({ stability: 5 });
    const r1 = retrievability(c, 5);
    const r2 = retrievability(c, 30);
    const r3 = retrievability(c, 365);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
    expect(r3).toBeGreaterThanOrEqual(0);
    expect(r1).toBeLessThan(1);
  });

  it("higher stability → higher R(t) for same elapsed time", () => {
    const c1 = card({ stability: 2 });
    const c2 = card({ stability: 20 });
    const r1 = retrievability(c1, 7);
    const r2 = retrievability(c2, 7);
    expect(r2).toBeGreaterThan(r1);
  });

  it("returns 1 for new cards", () => {
    expect(retrievability(card({ state: "new" }), 100)).toBe(1);
  });
});

describe("v2.30.0 — fsrs7 optimalInterval", () => {
  it("interval yields R(interval) ≈ target retention", () => {
    const c = card({ stability: 5 });
    for (const target of [0.7, 0.85, 0.9, 0.95]) {
      const iv = optimalInterval(c, target);
      const r = retrievability(c, iv);
      expect(Math.abs(r - target)).toBeLessThan(0.01);
    }
  });

  it("higher stability → longer interval", () => {
    const c1 = card({ stability: 2 });
    const c2 = card({ stability: 20 });
    expect(optimalInterval(c2, 0.9)).toBeGreaterThan(optimalInterval(c1, 0.9));
  });
});

describe("v2.30.0 — fsrs7 next()", () => {
  it("rating=Good (3) on review card increments reps and updates stability", () => {
    const start = card({ stability: 5, reps: 3, lapses: 0 });
    const r = next(start, 3);
    expect(r.next.reps).toBe(4);
    expect(r.next.stability).toBeGreaterThan(0);
    expect(r.newStability).toBeCloseTo(r.next.stability, 5);
    expect(r.interval).toBeGreaterThan(0);
    expect(r.due).toBeGreaterThan(Date.now() - 1000);
  });

  it("rating=Again (1) on review card increments lapses and moves to relearning", () => {
    const start = card({ stability: 10, lapses: 0, state: "review" });
    const r = next(start, 1);
    expect(r.next.lapses).toBe(1);
    expect(r.next.state).toBe("relearning");
    expect(r.interval).toBeLessThan(1); // minutes for relearning
  });

  it("post-lapse recovery boost (w[18]) applied", () => {
    const startNoBoost = card({ stability: 5, lapses: 1, state: "review" });
    const r1 = next(startNoBoost, 4, { applyPostLapseBoost: false });
    const r2 = next(startNoBoost, 4, { applyPostLapseBoost: true });
    expect(r2.newStability).toBeGreaterThan(r1.newStability);
  });

  it("rating=Perfect (5) on first review triggers learning state", () => {
    const start = card({ state: "new", stability: 0, reps: 0 });
    const r = next(start, 5);
    expect(r.next.state).toBe("learning");
    expect(r.next.stability).toBeGreaterThan(0);
  });
});

describe("v2.30.0 — calibrate", () => {
  it("empty history → defaults + patience=1", () => {
    const cal = calibrate([]);
    expect(cal.weights.length).toBe(DEFAULT_W.length);
    expect(cal.patience).toBe(1);
    expect(cal.sampleSize).toBe(0);
  });

  it("high outcome → higher w[17] curve stretch", () => {
    const goodHistory: ReviewEvent[] = Array.from({ length: 10 }).map((_, i) => ({
      cardId: `c${i}`, rating: 4, reviewedAt: 1000000 + i * 86400000, elapsedDays: 5, rAtReview: 0.92,
    }));
    const calGood = calibrate(goodHistory);
    const badHistory: ReviewEvent[] = Array.from({ length: 10 }).map((_, i) => ({
      cardId: `c${i}`, rating: 1, reviewedAt: 1000000 + i * 86400000, elapsedDays: 14, rAtReview: 0.4,
    }));
    const calBad = calibrate(badHistory);
    expect(calGood.weights[17]).toBeGreaterThan(calBad.weights[17]);
  });

  it("calibration stored and retrievable", () => {
    const cal = calibrate([
      { cardId: "x", rating: 3, reviewedAt: 1000, elapsedDays: 1, rAtReview: 0.85 },
    ]);
    calibrationStore.set("k1", cal);
    const got = calibrationStore.get("k1");
    expect(got.sampleSize).toBe(1);
  });
});

describe("v2.30.0 — predictive scheduler", () => {
  const NOW = 1_700_000_000_000;
  const DAY = 86_400_000;

  it("predictCard returns safe for new card", () => {
    const c = card({ state: "new", stability: 0 });
    const row = predictCard(c, { now: NOW });
    expect(row.action).toBe("safe");
    expect(row.risk).toBe(0);
  });

  it("predictCard returns review-now for stale high-rNo card", () => {
    const c = card({ stability: 2, lastReview: NOW - 60 * DAY });
    const row = predictCard(c, { now: NOW });
    expect(row.action).toBe("review-now");
  });

  it("predictCard returns safe for fresh card (high R)", () => {
    const c = card({ stability: 10, lastReview: NOW - 1 * DAY });
    const row = predictCard(c, { now: NOW });
    expect(row.action).toBe("safe");
    expect(row.rNow).toBeGreaterThan(0.9);
  });

  it("predictBatch results have per-card ids", () => {
    const rows = predictBatch(
      [
        { id: "a", card: card({ lastReview: NOW - 5 * DAY }) },
        { id: "b", card: card({ lastReview: NOW - 1 * DAY, stability: 50 }) },
      ],
      { now: NOW },
    );
    expect(rows.length).toBe(2);
  });

  it("timeToTargetR matches optimalInterval", () => {
    const c = card({ stability: 5 });
    const t = timeToTargetR(c, 0.9);
    const opt = optimalInterval(c, 0.9);
    expect(Math.abs(t - opt)).toBeLessThan(0.01);
  });

  it("optimalWindow returns cards sorted by risk desc", () => {
    const result = optimalWindow(
      [
        { id: "stale", card: card({ stability: 2, lastReview: NOW - 50 * DAY }) },
        { id: "fresh", card: card({ stability: 50, lastReview: NOW - 1 * DAY }) },
        { id: "mid", card: card({ stability: 5, lastReview: NOW - 8 * DAY }) },
      ],
      { now: NOW, limit: 10 },
    );
    expect(result.recommended[0].id).toBe("stale");
  });

  it("riskHeatmap aggregates cards by day of predicted forgetting", () => {
    const hm = riskHeatmap(
      [
        { id: "a", card: card({ stability: 5, lastReview: NOW - 1 * DAY }) },
        { id: "b", card: card({ stability: 10, lastReview: NOW - 1 * DAY }) },
      ],
      { now: NOW, days: 30 },
    );
    expect(hm.length).toBe(31); // 0..30 inclusive
    const totalCount = hm.reduce((s, d) => s + d.count, 0);
    expect(totalCount).toBeGreaterThanOrEqual(2);
  });
});
