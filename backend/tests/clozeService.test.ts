// Tests para ClozeService (Fase 3.A).

import { describe, it, expect } from "vitest";
import { ClozeService } from "../src/services/clozeService";

describe("ClozeService.parseCloze", () => {
  it("extracts single cloze", () => {
    const clozes = ClozeService.parseCloze("El {{c1::corazón}} late");
    expect(clozes).toHaveLength(1);
    expect(clozes[0].number).toBe(1);
    expect(clozes[0].hidden).toBe("corazón");
  });

  it("extracts cloze with hint", () => {
    const clozes = ClozeService.parseCloze("La {{c1::mitocondria::orgánulo}} genera ATP");
    expect(clozes).toHaveLength(1);
    expect(clozes[0].hint).toBe("orgánulo");
    expect(clozes[0].hidden).toBe("mitocondria");
  });

  it("extracts multiple clozes different numbers", () => {
    const clozes = ClozeService.parseCloze("{{c1::El corazón}} {{c2::bombea}} {{c3::sangre}}");
    expect(clozes).toHaveLength(3);
    expect(clozes.map((c) => c.number)).toEqual([1, 2, 3]);
  });

  it("extracts multiple clozes same number (e.g. c1 twice)", () => {
    const clozes = ClozeService.parseCloze("{{c1::Riñón}} y {{c1::hígado}} filtran");
    expect(clozes).toHaveLength(2);
    expect(clozes.every((c) => c.number === 1)).toBe(true);
  });

  it("returns empty for text without clozes", () => {
    expect(ClozeService.parseCloze("Texto normal sin cloze")).toEqual([]);
  });

  it("handles multiline content", () => {
    const text = `Línea 1
{{c1::Línea 2 con cloze}}
Línea 3 con {{c2::otro cloze}}`;
    const clozes = ClozeService.parseCloze(text);
    expect(clozes).toHaveLength(2);
  });
});

describe("ClozeService.generateCards", () => {
  it("generates one card per unique cloze number", () => {
    const cards = ClozeService.generateCards("{{c1::A}} {{c2::B}} {{c3::C}}");
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.number)).toEqual([1, 2, 3]);
  });

  it("combines multiple c1 into one card", () => {
    const cards = ClozeService.generateCards("{{c1::Riñón}} y {{c1::hígado}}");
    expect(cards).toHaveLength(1);
    expect(cards[0].number).toBe(1);
    // Ambos c1 están en textWithCloze como [...]
    const occ = (cards[0].textWithCloze.match(/\[\.\.\.\]/g) ?? []).length;
    expect(occ).toBe(2);
  });

  it("textWithAnswer shows ALL answers", () => {
    const cards = ClozeService.generateCards("{{c1::A}} y {{c2::B}}");
    expect(cards[0].textWithAnswer).toContain("**A**");
    expect(cards[0].textWithAnswer).toContain("**B**");
  });

  it("card for c1 hides c1, shows c2", () => {
    const cards = ClozeService.generateCards("{{c1::A}} y {{c2::B}}");
    const c1Card = cards.find((c) => c.number === 1)!;
    expect(c1Card.textWithCloze).toContain("[...]");
    expect(c1Card.textWithCloze).toContain("B"); // c2 visible
  });

  it("preserves hint in generated cards", () => {
    const cards = ClozeService.generateCards("{{c1::mitocondria::orgánulo}}");
    expect(cards[0].hint).toBe("orgánulo");
    expect(cards[0].textWithCloze).toContain("orgánulo");
  });

  it("returns empty for text without clozes", () => {
    expect(ClozeService.generateCards("Sin clozes")).toEqual([]);
  });

  it("medical use case: anatomy cloze", () => {
    const text = "El {{c1::nervio frénico}} inerva el {{c2::diafragma}} durante la {{c3::inspiración}}";
    const cards = ClozeService.generateCards(text);
    expect(cards).toHaveLength(3);
    expect(cards[0].textWithAnswer).toContain("**nervio frénico**");
    expect(cards[2].textWithAnswer).toContain("**inspiración**");
  });
});

describe("ClozeService.count", () => {
  it("counts unique cloze numbers", () => {
    expect(ClozeService.count("{{c1::A}} {{c1::B}} {{c2::C}}")).toBe(2);
  });

  it("returns 0 for no clozes", () => {
    expect(ClozeService.count("Nada")).toBe(0);
  });
});

describe("ClozeService.validate", () => {
  it("passes valid content", () => {
    expect(ClozeService.validate("{{c1::A}} y {{c2::B}}")).toEqual([]);
  });

  it("detects unclosed cloze", () => {
    const errors = ClozeService.validate("Texto {{c1::sin cerrar");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("sin cerrar");
  });

  it("detects invalid cloze number (0)", () => {
    const errors = ClozeService.validate("{{c0::texto}}");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("inválido");
  });

  it("detects negative cloze number", () => {
    const errors = ClozeService.validate("{{c-1::texto}}");
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("ClozeService.toMarkdown", () => {
  it("renders cloze as hidden (default)", () => {
    const md = ClozeService.toMarkdown("{{c1::respuesta}}");
    expect(md).toContain("cloze-hidden");
    expect(md).toContain("[...]");
    expect(md).not.toContain("respuesta");
  });

  it("renders cloze as answer when showAnswers=true", () => {
    const md = ClozeService.toMarkdown("{{c1::respuesta}}", { showAnswers: true });
    expect(md).toContain("cloze-answer");
    expect(md).toContain("respuesta");
  });

  it("shows hint when hidden", () => {
    const md = ClozeService.toMarkdown("{{c1::mitocondria::orgánulo}}");
    expect(md).toContain("orgánulo");
  });
});
