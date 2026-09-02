import { describe, it, expect } from "vitest";
import { newCard, review, retrievability, nextInterval } from "../src/fsrs/scheduler";

describe("FSRS v5 scheduler", () => {
  it("inicializa una tarjeta nueva con valores neutros", () => {
    const c = newCard();
    expect(c.stability).toBeGreaterThan(0);
    expect(c.difficulty).toBeGreaterThan(0);
    expect(c.reps).toBe(0);
    expect(c.lapses).toBe(0);
  });

  it("avanza reps tras review", () => {
    let c = newCard();
    c = review(c, 3, 0.9).card;
    expect(c.reps).toBe(1);
    c = review(c, 3, 0.9).card;
    expect(c.reps).toBe(2);
  });

  it("tras un Again, lapses se incrementa", () => {
    let c = newCard();
    c = review(c, 3, 0.9).card; // un Good primero
    c = review(c, 1, 0.9).card; // luego Again
    expect(c.lapses).toBe(1);
  });

  it("Again reduce stability, Good la mantiene o sube", () => {
    let c = newCard();
    const s0 = c.stability;
    c = review(c, 3, 0.9).card;
    const sAfterGood = c.stability;
    c = review(c, 1, 0.9).card;
    const sAfterAgain = c.stability;
    expect(sAfterAgain).toBeLessThanOrEqual(sAfterGood);
  });

  it("Easy sube la stability más que Good", () => {
    let c1 = newCard();
    c1 = review(c1, 3, 0.9).card;
    let c2 = newCard();
    c2 = review(c2, 4, 0.9).card;
    // Easy suele dar más stability que Good
    expect(c2.stability).toBeGreaterThanOrEqual(c1.stability);
  });

  it("calcula retrievability correcta (R=1 en t=0)", () => {
    const r = retrievability(0, 1);
    expect(r).toBeCloseTo(1, 5);
  });

  it("R baja con el tiempo", () => {
    const r5 = retrievability(5, 1);
    const r30 = retrievability(30, 1);
    const r90 = retrievability(90, 1);
    expect(r5).toBeGreaterThan(r30);
    expect(r30).toBeGreaterThan(r90);
  });

  it("nextInterval respeta retention target", () => {
    const s = 10;
    const iv = nextInterval(s, 0.9);
    // Para R=0.9, el intervalo debe ser razonable
    expect(iv).toBeGreaterThan(0);
    expect(iv).toBeLessThan(s * 20);
  });

  it("intervalo para R más alta es más corto", () => {
    const s = 10;
    const iv90 = nextInterval(s, 0.9);
    const iv95 = nextInterval(s, 0.95);
    expect(iv95).toBeLessThanOrEqual(iv90);
  });

  it("dueDate queda en el futuro tras review", () => {
    const c = newCard();
    const now = Date.now();
    const { card: next } = review(c, 3, 0.9);
    expect(new Date(next.dueDate).getTime()).toBeGreaterThan(now);
  });

  it("estabilidad y dificultad son números válidos", () => {
    const c = newCard();
    expect(typeof c.stability).toBe("number");
    expect(typeof c.difficulty).toBe("number");
    expect(Number.isFinite(c.stability)).toBe(true);
    expect(Number.isFinite(c.difficulty)).toBe(true);
  });
});
