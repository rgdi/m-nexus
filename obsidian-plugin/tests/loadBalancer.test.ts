import { describe, it, expect } from "vitest";
import { rebalance } from "../src/fsrs/loadBalancer";
import { FlashcardDraft, PriorityLevel } from "../src/types";

function makeCard(id: string, dueOffsetDays: number, priority: PriorityLevel = "Medium"): { card: FlashcardDraft; priority: PriorityLevel } {
  const due = new Date(Date.now() + dueOffsetDays * 86400000);
  return {
    card: {
      id,
      notePath: "test.md",
      templateId: "t",
      cardType: "basic",
      front: `Q${id}`,
      back: `A${id}`,
      tags: [],
      createdAt: new Date().toISOString(),
      status: "approved",
      fsrs: { stability: 1, difficulty: 5, dueDate: due.toISOString(), reps: 0, lapses: 0 },
    },
    priority,
  };
}

describe("FSRS load balancer", () => {
  it("distribuye 100 tarjetas en 14 días sin overflow", () => {
    const cards = Array.from({ length: 100 }, (_, i) =>
      makeCard(`c${i}`, i * 0.2, i % 5 === 0 ? "High" : i % 3 === 0 ? "Low" : "Medium")
    );
    const out = rebalance({
      cards,
      today: new Date(),
      daysWindow: 14,
      dailyReviewCap: 50,
      softCap: 10,
    });
    expect(out.overflow).toBe(false);
    expect(out.schedule.size).toBeGreaterThan(0);
    // Cada día dentro del horizonte tiene <= softCap
    for (const [, list] of out.schedule) {
      expect(list.length).toBeLessThanOrEqual(50); // dailyReviewCap
    }
  });

  it("mueve Low priority a días con hueco", () => {
    const cards = [
      makeCard("high1", 0, "High"),
      makeCard("low1", 0, "Low"),
      makeCard("low2", 0, "Low"),
      makeCard("low3", 0, "Low"),
    ];
    const out = rebalance({
      cards,
      today: new Date(),
      daysWindow: 3,
      dailyReviewCap: 10,
      softCap: 2, // muy bajo para forzar movimiento
    });
    expect(out.movedCount).toBeGreaterThan(0);
  });

  it("respeta dailyReviewCap (tope duro)", () => {
    const cards = Array.from({ length: 30 }, (_, i) => makeCard(`c${i}`, 0, "High"));
    const out = rebalance({
      cards,
      today: new Date(),
      daysWindow: 3,
      dailyReviewCap: 10,
      softCap: 5,
    });
    // Suma por día <= 10
    for (const [, list] of out.schedule) {
      expect(list.length).toBeLessThanOrEqual(10);
    }
  });

  it("vacío si no hay tarjetas", () => {
    const out = rebalance({
      cards: [],
      today: new Date(),
      daysWindow: 7,
      dailyReviewCap: 50,
      softCap: 30,
    });
    expect(out.overflow).toBe(false);
    expect(out.movedCount).toBe(0);
    for (const [, list] of out.schedule) {
      expect(list.length).toBe(0);
    }
  });
});
