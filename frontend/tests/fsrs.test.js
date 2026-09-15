/* ============================================================
 * fsrs.test.js — Unit tests for FSRS-4.5 spaced repetition.
 * v2.2.0 W6 — verifies algorithm correctness against Anki-grade spec.
 * ============================================================ */

import { describe, it, expect } from "vitest";
import { initCard, review, prioritize, FSRS_RATINGS } from "../src/services/fsrs.js";

const NOW = 1700000000000; // fixed timestamp for deterministic tests
const ONE_DAY = 24 * 60 * 60 * 1000;

describe("fsrs.js — FSRS-4.5 spaced repetition", () => {
  describe("initCard", () => {
    it("creates a new card with state='new'", () => {
      const c = initCard();
      expect(c.state).toBe("new");
      expect(c.stability).toBe(0);
      expect(c.difficulty).toBe(0);
      expect(c.reps).toBe(0);
      expect(c.lapses).toBe(0);
      expect(c.due).toBeGreaterThan(0);
    });
  });

  describe("review — new card", () => {
    it("Again → learning state, due in 1 minute", () => {
      const c = initCard();
      const out = review(c, 1, NOW);
      expect(out.state).toBe("learning");
      expect(out.reps).toBe(1);
      // Due should be ~1 minute from NOW
      expect(out.due - NOW).toBe(60 * 1000);
    });

    it("Hard → learning state, due in 10 minutes", () => {
      const c = initCard();
      const out = review(c, 2, NOW);
      expect(out.state).toBe("learning");
      expect(out.due - NOW).toBe(10 * 60 * 1000);
    });

    it("Good → graduates to review state", () => {
      const c = initCard();
      const out = review(c, 3, NOW);
      expect(out.state).toBe("review");
      expect(out.reps).toBe(1);
      // Should be due in ~1-3 days
      const intervalDays = (out.due - NOW) / ONE_DAY;
      expect(intervalDays).toBeGreaterThanOrEqual(1);
      expect(intervalDays).toBeLessThanOrEqual(5);
    });

    it("Easy → graduates with longer interval", () => {
      const c = initCard();
      const out = review(c, 4, NOW);
      expect(out.state).toBe("review");
      const intervalDays = (out.due - NOW) / ONE_DAY;
      expect(intervalDays).toBeGreaterThanOrEqual(3);
    });
  });

  describe("review — review card (lapses)", () => {
    it("Again on review state → relearning, decrements stability", () => {
      const c = {
        state: "review",
        stability: 5,
        difficulty: 5,
        lastReview: NOW - 5 * ONE_DAY,
        due: NOW,
        reps: 3,
        lapses: 0,
        learningStep: 0,
      };
      const out = review(c, 1, NOW);
      expect(out.state).toBe("relearning");
      expect(out.stability).toBeLessThan(c.stability); // stability decremented
      expect(out.lapses).toBe(1);
    });

    it("Good on review state → next interval (days)", () => {
      const c = {
        state: "review",
        stability: 10,
        difficulty: 5,
        lastReview: NOW - 10 * ONE_DAY,
        due: NOW,
        reps: 5,
        lapses: 0,
      };
      const out = review(c, 3, NOW);
      expect(out.state).toBe("review");
      expect(out.due).toBeGreaterThan(NOW + 5 * ONE_DAY);
    });
  });

  describe("prioritize", () => {
    // Note: prioritize uses Date.now() internally, not a passed-in now.
    const realNow = Date.now();

    it("orders cards by due date (earliest first)", () => {
      const cards = [
        { id: "a", fsrs: { ...initCard(), due: realNow + ONE_DAY } },
        { id: "b", fsrs: { ...initCard(), due: realNow } },
        { id: "c", fsrs: { ...initCard(), due: realNow + 0.5 * ONE_DAY } },
      ];
      const out = prioritize(cards);
      expect(out.map((c) => c.id)).toEqual(["b", "c", "a"]);
    });

    it("filters out cards due > 1 day from now", () => {
      const cards = [
        { id: "due-soon", fsrs: { ...initCard(), due: realNow } },
        { id: "due-far", fsrs: { ...initCard(), due: realNow + 30 * ONE_DAY } },
      ];
      const out = prioritize(cards);
      expect(out.length).toBe(1);
      expect(out[0].id).toBe("due-soon");
    });

    it("assigns overdueDays to each card", () => {
      const cards = [
        { id: "x", fsrs: { ...initCard(), due: realNow - 2 * ONE_DAY } },
      ];
      const out = prioritize(cards);
      expect(out[0].overdueDays).toBeGreaterThan(0);
    });
  });

  describe("FSRS_RATINGS", () => {
    it("has 4 ratings with values 1-4", () => {
      const vals = Object.values(FSRS_RATINGS).map((r) => r.value);
      expect(vals.sort()).toEqual([1, 2, 3, 4]);
    });

    it("has keyboard shortcuts", () => {
      expect(FSRS_RATINGS.again.shortcut).toBe("1");
      expect(FSRS_RATINGS.easy.shortcut).toBe("4");
    });
  });
});
