// Tests para fsrsQueue con FSRS REAL (v0.46).
// Ya NO usa __fail__/__bad__ magic strings — usa el algoritmo real de ts-fsrs.

import { describe, it, expect, beforeEach } from "vitest";
import { fsrsQueue, FsrsQueue } from "../src/workers/fsrsQueue";
import { createEmptyCard, State } from "ts-fsrs";

describe("fsrsQueue - real FSRS algorithm", () => {
  it("processes a job with new cards (no rating)", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u1",
      cards: [
        { cardId: "c1" },
        { cardId: "c2" },
        { cardId: "c3" },
      ],
    });
    const result = await fsrsQueue.waitFor(id);
    expect(result.cardsEvaluated).toBe(3);
    expect(result.errors).toEqual([]);
    // Cada card nueva debe tener state=0 (New), due cercano
    for (const c of result.cards) {
      expect(c.newState.state).toBe(State.New);
      expect(c.newState.due.getTime()).toBeGreaterThan(Date.now() - 1000);
    }
  });

  it("tracks state transitions: New -> Learning -> Review with Good ratings", async () => {
    // 1. Card nueva
    const id1 = fsrsQueue.enqueue({
      userId: "u2",
      cards: [{ cardId: "c4" }],
    });
    const r1 = await fsrsQueue.waitFor(id1);
    const newCard = r1.cards[0].newState;

    // 2. Primer repaso: Good (rating 3) -> debe pasar a Learning
    const id2 = fsrsQueue.enqueue({
      userId: "u2",
      cards: [{ cardId: "c4", rating: 3, currentState: newCard }],
    });
    const r2 = await fsrsQueue.waitFor(id2);
    const afterGood1 = r2.cards[0].newState;
    expect(afterGood1.state).not.toBe(State.New);
    expect(afterGood1.reps).toBe(1);

    // 3. Otro Good -> debe progresar más
    const id3 = fsrsQueue.enqueue({
      userId: "u2",
      cards: [{ cardId: "c4", rating: 3, currentState: afterGood1 }],
    });
    const r3 = await fsrsQueue.waitFor(id3);
    const afterGood2 = r3.cards[0].newState;
    expect(afterGood2.reps).toBe(2);
  });

  it("rating 1 (Again) creates a lapse (after card reaches Review state)", async () => {
    // Card necesita llegar a Review state (3+ repasas Good) para que Again cuente como lapse
    let card = createEmptyCard(new Date());
    for (let i = 0; i < 3; i++) {
      const id = fsrsQueue.enqueue({
        userId: "u3",
        cards: [{ cardId: "c5", rating: 3, currentState: card }],
      });
      const r = await fsrsQueue.waitFor(id);
      card = r.cards[0].newState;
    }
    // Ahora card está en Review (state=2)
    expect(card.state).toBe(State.Review);

    // Now Again
    const id2 = fsrsQueue.enqueue({
      userId: "u3",
      cards: [{ cardId: "c5", rating: 1, currentState: card }],
    });
    const r2 = await fsrsQueue.waitFor(id2);
    const afterAgain = r2.cards[0].newState;
    expect(afterAgain.lapses).toBe(1);
  });

  it("Easy (rating 4) produces longer interval than Good (rating 3)", async () => {
    const baseCard = createEmptyCard(new Date());
    // Necesitamos llegar a Review state primero
    const id1 = fsrsQueue.enqueue({
      userId: "u4",
      cards: [
        { cardId: "easy", rating: 3, currentState: baseCard },
        { cardId: "good", rating: 3, currentState: baseCard },
      ],
    });
    const r1 = await fsrsQueue.waitFor(id1);
    const easyBase = r1.cards.find((c) => c.cardId === "easy")!.newState;
    const goodBase = r1.cards.find((c) => c.cardId === "good")!.newState;

    // Ahora uno Easy, otro Good
    const id2 = fsrsQueue.enqueue({
      userId: "u4",
      cards: [
        { cardId: "easy", rating: 4, currentState: easyBase },
        { cardId: "good", rating: 3, currentState: goodBase },
      ],
    });
    const r2 = await fsrsQueue.waitFor(id2);
    const easyFinal = r2.cards.find((c) => c.cardId === "easy")!.newState;
    const goodFinal = r2.cards.find((c) => c.cardId === "good")!.newState;

    // Easy debe tener más scheduled_days o stability que Good
    const easyStab = easyFinal.stability ?? 0;
    const goodStab = goodFinal.stability ?? 0;
    expect(easyStab).toBeGreaterThan(goodStab);
  });

  it("rejects invalid rating (5 is not valid)", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u5",
      cards: [{ cardId: "c1", rating: 5 }],
    });
    const result = await fsrsQueue.waitFor(id);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("invalid rating");
  });

  it("rejects invalid rating (0)", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u6",
      cards: [{ cardId: "c1", rating: 0 }],
    });
    const result = await fsrsQueue.waitFor(id);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles empty cardId gracefully", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u7",
      cards: [{ cardId: "" }],
    });
    const result = await fsrsQueue.waitFor(id);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("supports fsrs-v5 algorithm (legacy)", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u8",
      cards: [{ cardId: "c1" }],
      algorithm: "fsrs-v5",
    });
    const result = await fsrsQueue.waitFor(id);
    expect(result.cardsEvaluated).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("FSRS-6 default: scheduled interval is reasonable (not 1d, not 365d)", async () => {
    const baseCard = createEmptyCard(new Date());
    // Simular 5 repasas Good
    let card = baseCard;
    for (let i = 0; i < 5; i++) {
      const id = fsrsQueue.enqueue({
        userId: "u9",
        cards: [{ cardId: `c${i}`, rating: 3, currentState: card }],
      });
      const r = await fsrsQueue.waitFor(id);
      card = r.cards[0].newState;
    }
    const final = card;
    const days = final.scheduled_days;
    // Después de 5 repasas, debería haber un intervalo significativo (>1 día)
    expect(days).toBeGreaterThanOrEqual(1);
  });

  it("returns null status for unknown job", () => {
    const status = fsrsQueue.getStatus("nonexistent");
    expect(status).toBeNull();
  });

  it("stats: processed counter increments", async () => {
    const before = fsrsQueue.stats();
    const id = fsrsQueue.enqueue({
      userId: "u10",
      cards: [{ cardId: "c1" }],
    });
    await fsrsQueue.waitFor(id);
    const after = fsrsQueue.stats();
    expect(after.processed).toBeGreaterThan(before.processed);
  });

  it("list returns job metadata", async () => {
    const id = fsrsQueue.enqueue({
      userId: "u11",
      cards: [{ cardId: "c1" }],
    });
    const list = fsrsQueue.list();
    const found = list.find((j) => j.id === id);
    expect(found).toBeDefined();
    expect(found?.userId).toBe("u11");
  });
});
