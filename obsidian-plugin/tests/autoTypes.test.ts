import { describe, it, expect } from "vitest";
import { localDetectType, normalizeType } from "../src/flashcards/autoTypes";
import { CardType } from "../src/types";

describe("autoTypes — heurística local", () => {
  it("detecta list por enumeración con números", () => {
    const text = `Pasos:
1. Primero se aplica
2. Luego se procesa
3. Finalmente se obtiene`;
    expect(localDetectType(text)).toBe("list");
  });

  it("detecta list por palabras clave (pasos, secuencia)", () => {
    expect(localDetectType("Los pasos del ciclo son:")).toBe("list");
  });

  it("detecta cloze por frase de definición", () => {
    const text = "La homeostasis es el mantenimiento de las condiciones internas del organismo.";
    expect(localDetectType(text)).toBe("cloze");
  });

  it("detecta reversed por equivalencias", () => {
    const text = "El equivalente en inglés de 'hígado' es 'liver'.";
    expect(localDetectType(text)).toBe("reversed");
  });

  it("fallback a basic", () => {
    expect(localDetectType("Texto cualquiera sin pistas")).toBe("basic");
  });

  it("normaliza tipos de LLM (cloze)", () => {
    expect(normalizeType("cloze")).toBe("cloze");
    expect(normalizeType("Cloze")).toBe("cloze");
  });

  it("normaliza tipos de LLM (reversed)", () => {
    expect(normalizeType("reversed")).toBe("reversed");
    expect(normalizeType("bidireccional")).toBe("reversed");
  });

  it("normaliza tipos de LLM (list)", () => {
    expect(normalizeType("list")).toBe("list");
    expect(normalizeType("paso")).toBe("list");
  });

  it("normaliza tipos de LLM (image-occlusion)", () => {
    expect(normalizeType("image-occlusion")).toBe("image-occlusion");
    expect(normalizeType("imagen")).toBe("image-occlusion");
  });

  it("devuelve null para tipo desconocido", () => {
    expect(normalizeType("xyz123")).toBe(null);
    expect(normalizeType(undefined)).toBe(null);
  });
});
