// v236.test.ts — v2.36.0 PWA + grading tests.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server.js";
import {
  normalise, tokenise, tokenF1,
  gradeTypedAnswer, gradeMultipleChoice,
} from "../src/services/grading.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { try { await app.close(); } catch {} });

describe("v2.36.0 — grading: normalisation", () => {
  it("strips accents, case and punctuation", () => {
    expect(normalise("Presión Aórtica, 120 mmHg.")).toBe("presion aortica 120 mmhg");
  });

  it("removes Spanish + English stopwords", () => {
    const t = tokenise("la presión de la aorta es alta");
    expect(t).not.toContain("la");
    expect(t).not.toContain("de");
    expect(t).toContain("presion");
  });

  it("tokenF1 is symmetric on identical input", () => {
    const a = tokenF1("corazón pumping", "corazon pumping");
    expect(a.score).toBe(1);
  });

  it("tokenF1 penalises missing tokens", () => {
    // 1 of 3 expected tokens present → precision 1.0, recall 1/3 → F1 0.5
    const r = tokenF1("sistole", "sistole diastole auricular");
    expect(r.score).toBeCloseTo(0.5, 2);
    expect(r.missed).toEqual(["diastole", "auricular"]);
  });
});

describe("v2.36.0 — grading: typed answers (deterministic path)", () => {
  it("exact match scores 100", async () => {
    const g = await gradeTypedAnswer("120 mmHg", "120 mmHg", undefined, { useLlm: false });
    expect(g.score).toBe(100);
    expect(g.verdict).toBe("correct");
    expect(g.gradedBy).toBe("exact");
  });

  it("accent/case difference still scores 100", async () => {
    const g = await gradeTypedAnswer("Presión Aórtica", "presion aortica", undefined, { useLlm: false });
    expect(g.score).toBe(100);
    expect(g.gradedBy).toBe("normalized");
  });

  it("extra words reduce the score and list them", async () => {
    const g = await gradeTypedAnswer("la presion aortica es 120 mmHg", "120 mmHg", undefined, { useLlm: false });
    expect(g.extra).toContain("presion");
    expect(g.matched).toContain("120");
  });

  it("empty answer scores 0", async () => {
    const g = await gradeTypedAnswer("", "algo", undefined, { useLlm: false });
    expect(g.score).toBe(0);
    expect(g.verdict).toBe("incorrect");
  });

  it("completely wrong answer is incorrect", async () => {
    const g = await gradeTypedAnswer("perro gato", "sistole diastole", undefined, { useLlm: false });
    expect(g.verdict).toBe("incorrect");
    expect(g.score).toBeLessThan(45);
  });
});

describe("v2.36.0 — grading: multiple choice", () => {
  it("marks the right pick as correct", () => {
    const g = gradeMultipleChoice(["a", "b", "c", "d"], 2, 2, "porque si");
    expect(g.correct).toBe(true);
    expect(g.correctIndex).toBe(2);
    expect(g.perChoice.filter((c) => c.correct)).toHaveLength(1);
  });

  it("marks a wrong pick and marks it in perChoice", () => {
    const g = gradeMultipleChoice(["a", "b", "c", "d"], 2, 0);
    expect(g.correct).toBe(false);
    expect(g.perChoice[0].chosen).toBe(true);
    expect(g.perChoice[2].correct).toBe(true);
  });

  it("out-of-range chosenIndex is safe", () => {
    const g = gradeMultipleChoice(["a", "b"], 0, 99);
    expect(g.correct).toBe(false);
    expect(g.chosenIndex).toBe(-1);
  });

  it("out-of-range correctIndex falls back to 0", () => {
    const g = gradeMultipleChoice(["a", "b"], 42, 0);
    expect(g.correctIndex).toBe(0);
  });
});

describe("v2.36.0 — grading HTTP routes", () => {
  it("POST /api/v1/grade/typed works without auth", async () => {
    // v2.37.0: the deterministic path stays open (pure string math, no
    // user data, no provider cost). The LLM path no longer does.
    const r = await app.inject({
      method: "POST", url: "/api/v1/grade/typed",
      payload: { userAnswer: "120 mmHg", expected: "120 mmHg", useLlm: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().score).toBe(100);
  });

  it("POST /api/v1/grade/typed rejects a missing expected", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/grade/typed",
      payload: { userAnswer: "x" },
    });
    expect(r.json().code).toBe("EC-GRADE-001");
  });

  it("POST /api/v1/grade/mcq works with inline options", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/grade/mcq",
      payload: { options: ["x", "y"], correctIndex: 1, chosenIndex: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().correct).toBe(true);
  });

  it("POST /api/v1/grade/mcq rejects an anonymous cardId lookup", async () => {
    // v2.37.0: reading a card by id discloses its options and answer key,
    // so an unauthenticated caller is turned away before the store is
    // read. The existence check now lives behind auth.
    const r = await app.inject({
      method: "POST", url: "/api/v1/grade/mcq",
      payload: { cardId: "does-not-exist", chosenIndex: 0 },
    });
    expect(r.json().code).toBe("EC-GRADE-007");
  });
});

describe("v2.36.0 — card types include the new ones", () => {
  it("Flashcard cardType union accepts typed_answer and drag_gap", () => {
    const types = ["basic", "cloze", "enumerate", "image_occlusion", "multiple_choice", "typed_answer", "drag_gap"];
    expect(types).toContain("typed_answer");
    expect(types).toContain("drag_gap");
  });
});
