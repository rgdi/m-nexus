// Tests de auto-rebalance.

import { describe, it, expect } from "vitest";
import { recommend, shouldTriggerRebalance, summarizeAdherence } from "../src/exams/autoRebalance";
import { type AdherenceRecord } from "../src/exams/boost";
import type { Exam } from "../src/exams/types";

function makeExam(): Exam {
  return {
    id: "exam-1",
    title: "Parcial",
    subject: "S",
    date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
    examType: "parcial",
    scopes: [],
    status: "active",
    priority: "medium",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeSchedule(days: number): { daysAvailable: number; totalCards: number; sessionsPerDay: number; days: any[]; alreadyMature: number; overdue: number; estimatedCoverage: number; warnings: string[] } {
  return {
    daysAvailable: days,
    totalCards: 0,
    sessionsPerDay: 1,
    days: [],
    alreadyMature: 0,
    overdue: 0,
    estimatedCoverage: 0.5,
    warnings: [],
  };
}

describe("recommend", () => {
  it("adherencia baja: sugiere reduce-scope", () => {
    const exam = makeExam();
    const rec = recommend(exam, {
      overallAdherence: 0.4,
      recentAdherence: 0.25, // < 0.3 = urgent
      problemDaysCount: 3,
      currentCoverage: 0.3,
      targetCoverage: 0.9,
      daysUntilExam: 5,
      pendingCards: 50,
      schedule: makeSchedule(5),
      dailyCap: 10,
      scopeCount: 2,
    });
    expect(rec.actions.some((a) => a.type === "reduce-scope")).toBe(true);
    expect(rec.urgent).toBe(true);
  });

  it("adherencia muy baja: marca como urgent", () => {
    const exam = makeExam();
    const rec = recommend(exam, {
      overallAdherence: 0.2,
      recentAdherence: 0.2,
      problemDaysCount: 5,
      currentCoverage: 0.1,
      targetCoverage: 0.9,
      daysUntilExam: 5,
      pendingCards: 100,
      schedule: makeSchedule(5),
      dailyCap: 10,
      scopeCount: 1,
    });
    expect(rec.urgent).toBe(true);
  });

  it("demasiadas cards para el tiempo: sugiere shift-exam", () => {
    const exam = makeExam();
    const rec = recommend(exam, {
      overallAdherence: 0.7,
      recentAdherence: 0.7,
      problemDaysCount: 0,
      currentCoverage: 0.5,
      targetCoverage: 0.9,
      daysUntilExam: 5,
      pendingCards: 200, // 200/10=20 días
      schedule: makeSchedule(5),
      dailyCap: 10,
      scopeCount: 3,
    });
    expect(rec.actions.some((a) => a.type === "shift-exam")).toBe(true);
  });

  it("adherencia excelente con cobertura baja: sugiere increase-cap", () => {
    const exam = makeExam();
    const rec = recommend(exam, {
      overallAdherence: 0.95,
      recentAdherence: 0.95,
      problemDaysCount: 0,
      currentCoverage: 0.4,
      targetCoverage: 0.9,
      daysUntilExam: 10,
      pendingCards: 50,
      schedule: makeSchedule(10),
      dailyCap: 10,
      scopeCount: 2,
    });
    expect(rec.actions.some((a) => a.type === "increase-cap")).toBe(true);
  });

  it("días overloaded: sugiere split-cards", () => {
    const exam = makeExam();
    const schedule = makeSchedule(5);
    schedule.days = [
      { date: "2026-01-01", cards: 20, newCards: 0, estimatedMinutes: 10, cardIds: [], topics: [], conflictsWith: [] },
    ];
    const rec = recommend(exam, {
      overallAdherence: 0.6,
      recentAdherence: 0.6,
      problemDaysCount: 1,
      currentCoverage: 0.5,
      targetCoverage: 0.9,
      daysUntilExam: 5,
      pendingCards: 30,
      schedule,
      dailyCap: 10,
      scopeCount: 1,
    });
    expect(rec.actions.some((a) => a.type === "split-cards")).toBe(true);
  });

  it("todo bien: mensaje positivo", () => {
    const exam = makeExam();
    const rec = recommend(exam, {
      overallAdherence: 0.9,
      recentAdherence: 0.85,
      problemDaysCount: 0,
      currentCoverage: 0.85,
      targetCoverage: 0.9,
      daysUntilExam: 10,
      pendingCards: 20,
      schedule: makeSchedule(10),
      dailyCap: 10,
      scopeCount: 2,
    });
    expect(rec.actions.some((a) => a.type === "add-time")).toBe(true);
  });
});

describe("shouldTriggerRebalance", () => {
  it("true si adherencia reciente < 0.5", () => {
    const records: AdherenceRecord[] = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 5, adherenceRate: 0.5, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 4, adherenceRate: 0.4, rolling7: 0 },
      { examId: "e1", date: "2026-01-03", planned: 10, completed: 3, adherenceRate: 0.3, rolling7: 0 },
    ];
    expect(shouldTriggerRebalance(records)).toBe(true);
  });

  it("true si >=3 días problemáticos", () => {
    const records: AdherenceRecord[] = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 2, adherenceRate: 0.2, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 1, adherenceRate: 0.1, rolling7: 0 },
      { examId: "e1", date: "2026-01-03", planned: 10, completed: 4, adherenceRate: 0.4, rolling7: 0 },
      { examId: "e1", date: "2026-01-04", planned: 10, completed: 3, adherenceRate: 0.3, rolling7: 0 },
    ];
    expect(shouldTriggerRebalance(records)).toBe(true);
  });

  it("false si todo bien", () => {
    const records: AdherenceRecord[] = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 9, adherenceRate: 0.9, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 8, adherenceRate: 0.8, rolling7: 0 },
    ];
    expect(shouldTriggerRebalance(records)).toBe(false);
  });
});

describe("summarizeAdherence", () => {
  it("devuelve resumen con overall, recent, trend", () => {
    const records: AdherenceRecord[] = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 5, adherenceRate: 0.5, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 6, adherenceRate: 0.6, rolling7: 0 },
      { examId: "e1", date: "2026-01-03", planned: 10, completed: 7, adherenceRate: 0.7, rolling7: 0 },
      { examId: "e1", date: "2026-01-04", planned: 10, completed: 8, adherenceRate: 0.8, rolling7: 0 },
    ];
    const s = summarizeAdherence(records);
    expect(s.overall).toBeCloseTo(0.65);
    expect(s.trend).toBe("up");
  });

  it("trend: down cuando cae", () => {
    const records: AdherenceRecord[] = [
      { examId: "e1", date: "2026-01-01", planned: 10, completed: 9, adherenceRate: 0.9, rolling7: 0 },
      { examId: "e1", date: "2026-01-02", planned: 10, completed: 8, adherenceRate: 0.8, rolling7: 0 },
      { examId: "e1", date: "2026-01-03", planned: 10, completed: 4, adherenceRate: 0.4, rolling7: 0 },
      { examId: "e1", date: "2026-01-04", planned: 10, completed: 3, adherenceRate: 0.3, rolling7: 0 },
    ];
    const s = summarizeAdherence(records);
    expect(s.trend).toBe("down");
  });

  it("vacío devuelve stable", () => {
    const s = summarizeAdherence([]);
    expect(s.trend).toBe("stable");
  });
});
