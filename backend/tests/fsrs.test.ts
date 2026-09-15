// fsrs.test.ts — vitest tests del FSRS algorithm (v1.8.0)
// Importa la implementación cliente-side (no tiene deps).

import { describe, it, expect } from "vitest";
import { review, initCard, FSRS_RATINGS } from "../../frontend/src/services/fsrs.js";

describe("FSRS v1.8.0 — Learning + requeue", () => {
  it("initCard returns new state with zero stability/difficulty", () => {
    const c = initCard();
    expect(c.state).toBe("new");
    expect(c.stability).toBe(0);
    expect(c.difficulty).toBe(0);
    expect(c.reps).toBe(0);
  });

  it("Again on new card → state learning + due in 1 min", () => {
    const c = initCard();
    const u = review(c, FSRS_RATINGS.again.value);
    expect(u.state).toBe("learning");
    expect(u.intervalDays).toBeLessThan(1 / 24);
    expect(u.lapses).toBe(1);
    expect(u.reps).toBe(1);
  });

  it("Hard on new card → state learning + due in 10 min", () => {
    const c = initCard();
    const u = review(c, FSRS_RATINGS.hard.value);
    expect(u.state).toBe("learning");
    expect(u.intervalDays).toBeGreaterThanOrEqual(1 / 144);
    expect(u.intervalDays).toBeLessThan(1);
  });

  it("Good on new card → graduate to review + 4 days", () => {
    const c = initCard();
    const u = review(c, FSRS_RATINGS.good.value);
    expect(u.state).toBe("review");
    expect(u.intervalDays).toBe(4);
  });

  it("Easy on new card → graduate to review + 7 days", () => {
    const c = initCard();
    const u = review(c, FSRS_RATINGS.easy.value);
    expect(u.state).toBe("review");
    expect(u.intervalDays).toBe(7);
  });

  it("Again on review card → relearning + lapse", () => {
    const c = { ...initCard(), state: "review", stability: 10, difficulty: 5, reps: 5, lapses: 0 };
    const u = review(c, FSRS_RATINGS.again.value);
    expect(u.state).toBe("relearning");
    expect(u.lapses).toBe(1);
    expect(u.stability).toBeLessThan(10);
  });

  it("Good on review card → keeps review + bigger interval", () => {
    const c = { ...initCard(), state: "review", stability: 5, difficulty: 5, reps: 5 };
    const u = review(c, FSRS_RATINGS.good.value);
    expect(u.state).toBe("review");
    expect(u.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it("Reps counter increments", () => {
    let c = initCard();
    c = review(c, 3);
    c = review(c, 3);
    c = review(c, 3);
    expect(c.reps).toBe(3);
  });

  it("Rating 1 (Again) is the worst path", () => {
    const c = initCard();
    const a = review(c, 1);
    const e = review(c, 4);
    expect(a.intervalDays).toBeLessThan(e.intervalDays);
    expect(a.lapses).toBeGreaterThan(e.lapses);
  });
});
