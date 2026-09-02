// Tests de adherencia.

import { describe, it, expect } from "vitest";
import {
  computeAdherence,
  overallAdherence,
  recentAdherence,
  problemDays,
  detailedProgress,
  InMemoryAdherenceStore,
  type ReviewEvent,
} from "../src/exams/adherence";
import type { Exam, Flashcard, ExamSchedule } from "../src/exams/types";

function makeExam(over: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    title: "X",
    subject: "S",
    date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    examType: "parcial",
    scopes: [],
    status: "active",
    priority: "medium",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function makeScheduleWithDays(days: { date: string; cards: number }[]): ExamSchedule {
  return {
    daysAvailable: days.length,
    totalCards: days.reduce((s, d) => s + d.cards, 0),
    sessionsPerDay: 1,
    days: days.map((d) => ({
      date: d.date,
      cards: d.cards,
      newCards: 0,
      estimatedMinutes: d.cards * 0.5,
      cardIds: Array.from({ length: d.cards }, (_, i) => `${d.date}-c${i}`),
      topics: [],
      conflictsWith: [],
    })),
    alreadyMature: 0,
    overdue: 0,
    estimatedCoverage: 1,
    warnings: [],
  };
}

describe("computeAdherence", () => {
  it("calcula adherencia por día", () => {
    const today = new Date();
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const exam = makeExam({ schedule: makeScheduleWithDays([
      { date: today.toISOString().slice(0, 10), cards: 5 },
      { date: tomorrow.toISOString().slice(0, 10), cards: 3 },
    ]) });
    const reviews: ReviewEvent[] = [
      { cardId: `${today.toISOString().slice(0, 10)}-c0`, examId: exam.id, date: today.toISOString().slice(0, 10), rating: "good", durationMs: 1000 },
      { cardId: `${today.toISOString().slice(0, 10)}-c1`, examId: exam.id, date: today.toISOString().slice(0, 10), rating: "good", durationMs: 1000 },
    ];
    const recs = computeAdherence(exam, reviews);
    expect(recs[0].planned).toBe(5);
    expect(recs[0].completed).toBe(2);
    expect(recs[0].adherenceRate).toBeCloseTo(0.4);
  });

  it("rolling7 se calcula correctamente", () => {
    const today = new Date();
    const days: { date: string; cards: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      days.push({ date: d.toISOString().slice(0, 10), cards: 2 });
    }
    const exam = makeExam({ schedule: makeScheduleWithDays(days) });
    const recs = computeAdherence(exam, []);
    // Sin reviews, todos los días tienen 0 completadas / 2 planeadas = 0
    expect(recs[2].rolling7).toBeCloseTo(0);
  });

  it("reviews con examId null cuentan para cualquier examen", () => {
    const today = new Date();
    const exam = makeExam({ schedule: makeScheduleWithDays([{ date: today.toISOString().slice(0, 10), cards: 2 }]) });
    const reviews: ReviewEvent[] = [
      { cardId: `${today.toISOString().slice(0, 10)}-c0`, examId: null, date: today.toISOString().slice(0, 10), rating: "good", durationMs: 1000 },
    ];
    const recs = computeAdherence(exam, reviews);
    expect(recs[0].completed).toBe(1);
  });
});

describe("overallAdherence", () => {
  it("media de adherencias diarias", () => {
    const records = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 5, adherenceRate: 0.5, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 8, adherenceRate: 0.8, rolling7: 0 },
    ];
    expect(overallAdherence(records)).toBeCloseTo(0.65);
  });

  it("1.0 si no hay records", () => {
    expect(overallAdherence([])).toBe(1);
  });
});

describe("recentAdherence", () => {
  it("últimos N días", () => {
    const records = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 10, adherenceRate: 1, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 5, adherenceRate: 0.5, rolling7: 0 },
    ];
    expect(recentAdherence(records, 2)).toBeCloseTo(0.75);
  });
});

describe("problemDays", () => {
  it("filtra por debajo del threshold", () => {
    const records = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 2, adherenceRate: 0.2, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 9, adherenceRate: 0.9, rolling7: 0 },
    ];
    const probs = problemDays(records, 0.5);
    expect(probs).toHaveLength(1);
    expect(probs[0].date).toBe("2026-01-01");
  });
});

describe("detailedProgress", () => {
  it("calcula adherencia + coverage + boosts", () => {
    const exam = makeExam();
    const cards: Flashcard[] = [
      { id: "c1", notePath: "a.md", templateId: "t", cardType: "conceptual" as never, front: "F", back: "B", tags: [], createdAt: new Date().toISOString(), status: "approved" as never, stability: 30, difficulty: 3, dueDate: "", reps: 5, lapses: 0, subject: "X" },
      { id: "c2", notePath: "b.md", templateId: "t", cardType: "conceptual" as never, front: "F", back: "B", tags: [], createdAt: new Date().toISOString(), status: "approved" as never, stability: 5, difficulty: 3, dueDate: "", reps: 1, lapses: 0, subject: "X" },
    ];
    const reviews: ReviewEvent[] = [];
    const p = detailedProgress(exam, cards, reviews);
    expect(p.totalCards).toBe(2);
    expect(p.reviewedCards).toBe(2);
    expect(p.matureCards).toBe(1);
    expect(p.coverage).toBe(0.5);
  });
});

describe("InMemoryAdherenceStore", () => {
  it("load/save/append funcionan", () => {
    const store = new InMemoryAdherenceStore();
    expect(store.load()).toEqual([]);
    store.append({ cardId: "c1", examId: "e1", date: "2026-01-01", rating: "good", durationMs: 100 });
    expect(store.load()).toHaveLength(1);
    store.save([{ cardId: "c2", examId: null, date: "2026-01-02", rating: "hard", durationMs: 200 }]);
    expect(store.load()).toHaveLength(1);
    expect(store.load()[0].cardId).toBe("c2");
  });
});
