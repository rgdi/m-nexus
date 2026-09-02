import { describe, it, expect } from "vitest";
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID } from "../src/flashcards/builtinTemplates";

describe("Flashcard templates", () => {
  it("hay al menos 1 template built-in", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThan(0);
  });

  it("cada template tiene campos obligatorios", () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.subject).toBeTruthy();
      expect(t.systemPrompt.length).toBeGreaterThan(20);
      expect(t.userPrompt.length).toBeGreaterThan(20);
      expect(["basic", "cloze", "reversed", "list", "image-occlusion", "freeform"]).toContain(t.cardType);
      expect(["json", "markdown", "regex"]).toContain(t.parserStrategy);
      expect(["definitions", "lists", "headings", "none"]).toContain(t.localFallback);
      expect(t.builtin).toBe(true);
    }
  });

  it("el template por defecto existe", () => {
    const t = BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID);
    expect(t).toBeTruthy();
  });

  it("no hay IDs duplicados", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("los placeholders son válidos", () => {
    for (const t of BUILTIN_TEMPLATES) {
      // Al menos debe usar {{noteContent}} o un placeholder razonable
      const hasPlaceholder =
        t.userPrompt.includes("{{noteContent}}") ||
        t.userPrompt.includes("{{noteTitle}}") ||
        t.userPrompt.includes("{{subject}}");
      expect(hasPlaceholder).toBe(true);
    }
  });
});
