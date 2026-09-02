import { describe, it, expect } from "vitest";
import { parseLlmResponse } from "../src/flashcards/parser";
import { FlashcardTemplate } from "../src/types";

const tpl: FlashcardTemplate = {
  id: "t",
  name: "Test",
  subject: "general",
  description: "",
  cardType: "basic",
  systemPrompt: "",
  userPrompt: "",
  parserStrategy: "json",
  parserConfig: { jsonExample: '[{"front":"...","back":"..."}]' },
  localFallback: "definitions",
  autoTags: ["auto"],
  examples: [],
  builtin: true,
};

describe("LLM response parser", () => {
  it("parsea JSON limpio", () => {
    const raw = `[{"front":"¿Qué es X?","back":"Es Y","tags":["t1"]}]`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards.length).toBe(1);
    expect(r.cards[0].front).toBe("¿Qué es X?");
    expect(r.warnings.length).toBe(0);
  });

  it("parsea JSON envuelto en ```json fences", () => {
    const raw = "```json\n[{\"front\":\"Q\",\"back\":\"A\"}]\n```";
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards.length).toBe(1);
  });

  it("parsea JSON con preámbulo y array embebido", () => {
    const raw = `Claro, aquí están:\n[{"front":"Q","back":"A"}]\nSaludos.`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards.length).toBe(1);
  });

  it("acepta objeto con {cards: [...]}", () => {
    const raw = `{"cards":[{"front":"Q","back":"A"}]}`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards.length).toBe(1);
  });

  it("descarta items sin front/back y avisa", () => {
    const raw = `[{"front":"OK","back":"OK"},{"back":"sin front"}]`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards.length).toBe(1);
    expect(r.warnings.some((w) => w.includes("descartado"))).toBe(true);
  });

  it("respeta autoTags del template", () => {
    const raw = `[{"front":"Q","back":"A","tags":["propio"]}]`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards[0].tags).toContain("auto");
    expect(r.cards[0].tags).toContain("propio");
  });

  it("asigna IDs únicos", () => {
    const raw = `[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards[0].id).not.toBe(r.cards[1].id);
  });

  it("captura extra fields (cloze, occlusions)", () => {
    const raw = `[{"front":"Q","back":"A","cloze":"hola","occlusions":[{"x":0}]}]`;
    const r = parseLlmResponse(raw, tpl, "x.md");
    expect(r.cards[0].extra?.cloze).toBe("hola");
    expect(Array.isArray(r.cards[0].extra?.occlusions)).toBe(true);
  });

  it("devuelve warnings si la respuesta es basura", () => {
    const r = parseLlmResponse("esto no es JSON", tpl, "x.md");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("parser markdown: extrae pares Pregunta/Respuesta", () => {
    const mdTpl = { ...tpl, parserStrategy: "markdown" as const };
    const raw = `**Pregunta:** ¿Qué es X?
**Respuesta:** Es Y.
---
**Pregunta:** ¿Y Z?
**Respuesta:** Es W.`;
    const r = parseLlmResponse(raw, mdTpl, "x.md");
    expect(r.cards.length).toBe(2);
    expect(r.cards[0].front).toContain("X");
    expect(r.cards[0].back).toContain("Y");
  });
});
