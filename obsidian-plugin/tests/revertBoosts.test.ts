// v0.17: Test del fix de revertBoosts (marca applied=false).

import { describe, it, expect } from "vitest";
import { revertBoosts, applyBoosts, generateBoost } from "../src/exams/fsrsIntegration";
import type { FlashcardFSRS, Exam } from "../src/exams/types";

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeCard(over: Partial<FlashcardFSRS> = {}): FlashcardFSRS {
  return {
    id: "c1",
    notePath: "T.md",
    front: "q",
    back: "a",
    topic: "t",
    dueDate: dayOffset(10),
    stability: 1,
    difficulty: 0.5,
    lastReview: dayOffset(-2),
    reps: 1,
    lapses: 0,
    suspended: false,
    ...over,
  };
}

function makeExam(): Exam {
  return {
    id: "e1", title: "X", subject: "S", date: dayOffset(7),
    examType: "parcial", scopes: [], status: "active", priority: "medium",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

describe("revertBoosts — fix Bug 8", () => {
  it("revert marca applied=false en boostHistory", () => {
    const exam = makeExam();
    const card = makeCard();
    const boost = generateBoost(card, exam);
    expect(boost).not.toBeNull();
    applyBoosts([card], exam);
    expect(card.boostHistory?.[0].applied).toBe(true);

    revertBoosts([card], exam.id);

    // Bug 8 FIX: ahora applied debe ser false
    expect(card.boostHistory?.[0].applied).toBe(false);
  });

  it("revert doble no re-revierte (idempotente)", () => {
    const exam = makeExam();
    const card = makeCard();
    const originalDue = card.dueDate;
    applyBoosts([card], exam);
    const boosted = card.dueDate;
    expect(boosted).not.toBe(originalDue);

    revertBoosts([card], exam.id);
    const afterFirst = card.dueDate;
    expect(afterFirst).toBe(originalDue);

    // Segunda llamada: NO debe cambiar nada (idempotente)
    revertBoosts([card], exam.id);
    expect(card.dueDate).toBe(originalDue);
  });

  it("revert examBoost.applied = false", () => {
    const exam = makeExam();
    const card = makeCard();
    applyBoosts([card], exam);
    expect(card.examBoost?.applied).toBe(true);

    revertBoosts([card], exam.id);
    expect(card.examBoost?.applied).toBe(false);
  });

  it("revert con examId inexistente no afecta nada", () => {
    const exam = makeExam();
    const card = makeCard();
    const originalDue = card.dueDate;
    applyBoosts([card], exam);
    const boosted = card.dueDate;
    expect(boosted).not.toBe(originalDue);

    revertBoosts([card], "otro-exam");
    // Como no se encuentra, dueDate se queda como está (boosted)
    expect(card.dueDate).toBe(boosted);
  });
});
