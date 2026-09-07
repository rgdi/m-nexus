// Tests para TypeAnswerService (Fase 3.C).

import { describe, it, expect } from "vitest";
import { TypeAnswerService, levenshtein } from "../src/services/typeAnswerService";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hola", "hola")).toBe(0);
  });

  it("returns length for empty string", () => {
    expect(levenshtein("", "hola")).toBe(4);
    expect(levenshtein("hola", "")).toBe(4);
  });

  it("counts substitutions", () => {
    expect(levenshtein("hola", "hilo")).toBe(2);
  });

  it("counts insertions", () => {
    expect(levenshtein("hola", "holas")).toBe(1);
  });

  it("counts deletions", () => {
    expect(levenshtein("holas", "hola")).toBe(1);
  });

  it("handles medical terms", () => {
    expect(levenshtein("paracetamol", "paracetamul")).toBe(1);
    expect(levenshtein("ibuprofeno", "ibuprofeno")).toBe(0);
  });
});

describe("TypeAnswerService.parseFromFrontmatter", () => {
  it("parses basic type_answer", () => {
    const content = `---
type_answer:
  question: ¿Capital de Francia?
  answers: ["París", "Paris"]
---

# Card`;
    const card = TypeAnswerService.parseFromFrontmatter(content);
    expect(card).not.toBeNull();
    expect(card!.question).toBe("¿Capital de Francia?");
    expect(card!.answers).toEqual(["París", "Paris"]);
  });

  it("returns null for content without type_answer", () => {
    const content = `---
title: Test
---

# Algo`;
    expect(TypeAnswerService.parseFromFrontmatter(content)).toBeNull();
  });

  it("parses caseSensitive flag", () => {
    const content = `---
type_answer:
  question: Test
  answers: ["A"]
  caseSensitive: true
---`;
    const card = TypeAnswerService.parseFromFrontmatter(content);
    expect(card!.caseSensitive).toBe(true);
  });

  it("parses custom fuzzyThreshold", () => {
    const content = `---
type_answer:
  question: Test
  answers: ["Respuesta"]
  fuzzyThreshold: 3
---`;
    const card = TypeAnswerService.parseFromFrontmatter(content);
    expect(card!.fuzzyThreshold).toBe(3);
  });

  it("parses inline answers format", () => {
    const content = `---
type_answer:
  question: Test
  answers: A, B, C
---`;
    const card = TypeAnswerService.parseFromFrontmatter(content);
    expect(card!.answers).toEqual(["A", "B", "C"]);
  });

  it("default fuzzyThreshold is 2", () => {
    const content = `---
type_answer:
  question: Test
  answers: ["X"]
---`;
    const card = TypeAnswerService.parseFromFrontmatter(content);
    expect(card!.fuzzyThreshold).toBe(2);
  });

  it("default trimWhitespace is true", () => {
    const content = `---
type_answer:
  question: Test
  answers: ["X"]
---`;
    const card = TypeAnswerService.parseFromFrontmatter(content);
    expect(card!.trimWhitespace).toBe(true);
  });
});

describe("TypeAnswerService.evaluate", () => {
  const card: any = {
    question: "Test",
    answers: ["París", "Paris"],
    caseSensitive: false,
    fuzzyThreshold: 2,
    trimWhitespace: true,
  };

  it("accepts exact match", () => {
    const result = TypeAnswerService.evaluate(card, "París");
    expect(result.correct).toBe(true);
    expect(result.distance).toBe(0);
  });

  it("accepts alternative answer", () => {
    const result = TypeAnswerService.evaluate(card, "Paris");
    expect(result.correct).toBe(true);
  });

  it("rejects wrong answer (beyond threshold)", () => {
    const result = TypeAnswerService.evaluate(card, "Londres");
    expect(result.correct).toBe(false);
    expect(result.almost).toBe(false);
  });

  it("accepts fuzzy match within threshold", () => {
    const result = TypeAnswerService.evaluate(card, "Pari");
    expect(result.correct).toBe(false);
    expect(result.almost).toBe(true);
    expect(result.distance).toBe(1);
  });

  it("is case-insensitive by default", () => {
    const result = TypeAnswerService.evaluate(card, "PARÍS");
    expect(result.correct).toBe(true);
  });

  it("respects caseSensitive flag", () => {
    const caseSensitiveCard = { ...card, caseSensitive: true };
    const result = TypeAnswerService.evaluate(caseSensitiveCard, "parís");
    expect(result.correct).toBe(false);
    expect(result.almost).toBe(true);
  });

  it("trims whitespace", () => {
    const result = TypeAnswerService.evaluate(card, "  París  ");
    expect(result.correct).toBe(true);
  });

  it("ignores trimWhitespace=false when set", () => {
    const noTrimCard = { ...card, trimWhitespace: false };
    const result = TypeAnswerService.evaluate(noTrimCard, "París ");
    expect(result.correct).toBe(false);
  });

  it("computes score 1.0 for exact match", () => {
    const result = TypeAnswerService.evaluate(card, "París");
    expect(result.score).toBe(1);
  });

  it("computes score 0 for completely wrong answer", () => {
    const result = TypeAnswerService.evaluate(card, "zzzzzzzzzz");
    expect(result.score).toBeLessThan(0.2);
  });

  it("includes matched canonical answer", () => {
    const result = TypeAnswerService.evaluate(card, "Paris");
    expect(result.matchedAnswer).toBe("Paris");
  });
});
