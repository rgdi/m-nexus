// Tests de FSRS integration.

import { describe, it, expect } from "vitest";
import {
  shouldBoost,
  generateBoost,
  applyBoosts,
  revertBoosts,
  optimalCadence,
  defaultFSRSAdapter,
  type FSRSAdapter,
} from "../src/exams/fsrsIntegration";
import type { Flashcard, Exam } from "../src/exams/types";
import type { FlashcardFSRS } from "../src/exams/boost";

function makeCard(over: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "c1",
    notePath: "Bioquímica/A.md",
    templateId: "t",
    cardType: "conceptual" as never,
    front: "F",
    back: "B",
    tags: [],
    createdAt: new Date().toISOString(),
    status: "approved" as never,
    stability: 10,
    difficulty: 3,
    dueDate: new Date().toISOString().slice(0, 10),
    reps: 1,
    lapses: 0,
    subject: "Bioquímica",
    ...over,
  };
}

function makeExam(over: Partial<Exam> = {}): Exam {
  const inTenDays = new Date();
  inTenDays.setDate(inTenDays.getDate() + 10);
  return {
    id: "exam-1",
    title: "Parcial",
    subject: "Bioquímica",
    date: inTenDays.toISOString().slice(0, 10),
    examType: "parcial",
    scopes: [{ type: "note", path: "Bioquímica/A.md" }],
    status: "active",
    priority: "high",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("FSRS integration — shouldBoost", () => {
  it("devuelve should:false si dueDate es antes del target", () => {
    const today = new Date().toISOString().slice(0, 10);
    const card = makeCard({ dueDate: today });
    const exam = makeExam();
    const r = shouldBoost(card, exam);
    expect(r.should).toBe(false);
  });

  it("devuelve should:true si dueDate es DESPUÉS del target", () => {
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const card = makeCard({ dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const exam = makeExam();
    const r = shouldBoost(card, exam);
    expect(r.should).toBe(true);
    expect(r.reason).toBe("exam-before-due");
  });

  it("devuelve should:true con confidence=1 si está atrasada", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 5);
    const card = makeCard({ dueDate: yesterday.toISOString().slice(0, 10) });
    const exam = makeExam();
    const r = shouldBoost(card, exam);
    expect(r.should).toBe(true);
    expect(r.reason).toBe("exam-overdue-card");
    expect(r.confidence).toBe(1);
  });

  it("no boostea si el examen ya pasó", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const card = makeCard({ dueDate: yesterday.toISOString().slice(0, 10) });
    const exam = makeExam({ date: yesterday.toISOString().slice(0, 10) });
    const r = shouldBoost(card, exam);
    expect(r.should).toBe(false);
  });

  it("respet maxPullInDays: no boost si está demasiado lejos", () => {
    const inSixtyDays = new Date();
    inSixtyDays.setDate(inSixtyDays.getDate() + 60);
    const card = makeCard({ dueDate: inSixtyDays.toISOString().slice(0, 10) });
    const exam = makeExam();
    const r = shouldBoost(card, exam, { maxPullInDays: 14 });
    expect(r.should).toBe(false);
  });
});

describe("FSRS integration — generateBoost", () => {
  it("genera un boost con días pulled-in correctos", () => {
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const card = makeCard({ dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const exam = makeExam();
    const boost = generateBoost(card, exam);
    expect(boost).not.toBeNull();
    expect(boost!.daysPulledIn).toBeGreaterThan(0);
  });

  it("devuelve null si no necesita boost", () => {
    const today = new Date().toISOString().slice(0, 10);
    const card = makeCard({ dueDate: today });
    const exam = makeExam();
    expect(generateBoost(card, exam)).toBeNull();
  });
});

describe("FSRS integration — applyBoosts", () => {
  it("aplica boosts y muta las cards", () => {
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const cards: Flashcard[] = [
      makeCard({ id: "c1", dueDate: inTwentyDays.toISOString().slice(0, 10) }),
      makeCard({ id: "c2", dueDate: inTwentyDays.toISOString().slice(0, 10) }),
      makeCard({ id: "c3", dueDate: new Date().toISOString().slice(0, 10) }), // no necesita boost
    ];
    const exam = makeExam();
    const adapter: FSRSAdapter = {
      naturalDue: defaultFSRSAdapter.naturalDue,
      applyBoost(card, newDue) { card.dueDate = newDue; },
    };
    const { boosts } = applyBoosts(cards, exam, undefined, adapter);
    expect(boosts.length).toBe(2);
    expect(boosts[0].applied).toBe(true);
    // Las cards c1 y c2 deben tener dueDate adelantado
    expect(cards[0].dueDate).not.toBe(inTwentyDays.toISOString().slice(0, 10));
  });

  it("no aplica si applyBoosts está deshabilitado en el caller", () => {
    // applyBoosts aplica siempre; el caller decide si llamar
    // Esto se valida en scheduler.test
  });
});

describe("FSRS integration — revertBoosts", () => {
  it("revierte los boosts de un examen específico", () => {
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const original = inTwentyDays.toISOString().slice(0, 10);
    const cards: Flashcard[] = [
      makeCard({ id: "c1", dueDate: original }),
    ];
    const exam = makeExam();
    const adapter: FSRSAdapter = {
      naturalDue: defaultFSRSAdapter.naturalDue,
      applyBoost(card, newDue) { card.dueDate = newDue; },
    };
    const { boosts } = applyBoosts(cards, exam, undefined, adapter);
    expect(boosts[0].originalDueDate).toBe(original);
    expect(cards[0].dueDate).not.toBe(original);
    revertBoosts(cards as FlashcardFSRS[], exam.id, adapter);
    expect(cards[0].dueDate).toBe(original);
  });

  it("no afecta boosts de otros exámenes", () => {
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const original = inTwentyDays.toISOString().slice(0, 10);
    const cards: Flashcard[] = [makeCard({ id: "c1", dueDate: original })];
    const examA = makeExam({ id: "A" });
    // B es un examen MÁS CERCANO, así que genera su propio boost
    const inFiveDays = new Date();
    inFiveDays.setDate(inFiveDays.getDate() + 5);
    const examB = makeExam({ id: "B", date: inFiveDays.toISOString().slice(0, 10) });
    const adapter: FSRSAdapter = {
      naturalDue: defaultFSRSAdapter.naturalDue,
      applyBoost(card, newDue) { card.dueDate = newDue; },
    };
    applyBoosts(cards, examA, undefined, adapter);
    const newDueA = cards[0].dueDate; // target de A
    expect(newDueA).not.toBe(original);
    applyBoosts(cards, examB, undefined, adapter);
    const newDueB = cards[0].dueDate; // target de B (más cercano)
    expect(newDueB).not.toBe(newDueA);
    // examBoost queda con el último (B)
    const fsrsCard = cards[0] as FlashcardFSRS;
    expect(fsrsCard.examBoost?.examId).toBe("B");
    // boostHistory debe tener 2 entries
    expect(fsrsCard.boostHistory?.length).toBe(2);
    // Revertir A: dueDate vuelve a su original (no al de B)
    revertBoosts(cards as FlashcardFSRS[], examA.id, adapter);
    expect(cards[0].dueDate).toBe(original);
  });
});

describe("FSRS integration — optimalCadence", () => {
  it("devuelve fsrs si no hay exámenes activos en el scope", () => {
    const card = makeCard();
    const exam = makeExam({ scopes: [{ type: "folder", path: "Anatomía", includeSubfolders: false }], status: "active" });
    const r = optimalCadence(card, [exam]);
    expect(r.source).toBe("fsrs");
  });

  it("devuelve exam-boost si la card está en el scope", () => {
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const card = makeCard({ dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const exam = makeExam();
    const r = optimalCadence(card, [exam]);
    expect(r.source).toBe("exam-boost");
    expect(r.examId).toBe(exam.id);
  });

  it("elige el examen con target más cercano entre varios", () => {
    const inFiveDays = new Date();
    inFiveDays.setDate(inFiveDays.getDate() + 5);
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const card = makeCard({ dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const examA = makeExam({ id: "A", date: inTwentyDays.toISOString().slice(0, 10) });
    const examB = makeExam({ id: "B", date: inFiveDays.toISOString().slice(0, 10) });
    const r = optimalCadence(card, [examA, examB]);
    expect(r.examId).toBe("B");
  });
});
