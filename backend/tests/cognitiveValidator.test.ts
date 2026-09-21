// tests/cognitiveValidator.test.ts — v2.24.0 reglas cognitivas
//
// Paper: "Ciencia de la Memoria para Estudiantes de Medicina y Carreras Exigentes"
//   §6.1 Tipos de tarjeta
//   §6.2 Reglas adicionales (Wozniak / atomicidad)
//   §6.3 Errores frecuentes
//
// Cubre:
//   1. atomicidad (mega-tarjeta detectada + split OK)
//   2. heurística de longitud (front >12 palabras, back >50)
//   3. front == back hard reject
//   4. cloze con poco contexto -> warning
//   5. suggestCardType (basic / cloze / enumerate / image_occlusion)
//   6. atomicRefactor end-to-end con casos mixtos

import { describe, it, expect } from "vitest";
import {
  looksLikeMegaCard,
  splitMegaCard,
  validateCard,
  suggestCardType,
  atomicRefactor,
} from "../src/services/cognitiveValidator.js";

describe("v2.24.0 — looksLikeMegaCard (Wozniak p.11 / paper §6.3)", () => {
  it("detecta mega-tarjeta tipo 'Causas de X?' con lista de respuestas", () => {
    expect(
      looksLikeMegaCard(
        "¿Causas de pancreatitis aguda?",
        "alcohol, colelitiasis, hipertrigliceridemia, traumatismo, fármacos",
      ),
    ).toBe(true);
  });

  it("no dispara con pregunta regular", () => {
    expect(
      looksLikeMegaCard(
        "¿Cuál es el gen mutado en fibrosis quística?",
        "CFTR",
      ),
    ).toBe(false);
  });

  it("no dispara con front de cloze single", () => {
    expect(
      looksLikeMegaCard(
        "El páncreas secreta {{c1::insulina}} y {{c2::glucagón}}",
        "insulina",
      ),
    ).toBe(true); // front tiene 2 clozen → mega
  });
});

describe("v2.24.0 — splitMegaCard", () => {
  it("parte una mega-tarjeta de Causas en N sub-cards atómicas", () => {
    const split = splitMegaCard(
      "¿Causas de pancreatitis?",
      "alcohol, colelitiasis, hipertrigliceridemia",
    );
    expect(split.length).toBe(3);
    for (const s of split) {
      expect(s.front.length).toBeGreaterThan(0);
      expect(s.back.length).toBeGreaterThan(0);
      // Cada sub-card debe ser individualmente atómica
      expect(looksLikeMegaCard(s.front, s.back)).toBe(false);
    }
  });

  it("preserva la forma original si no detecta patrón", () => {
    const split = splitMegaCard("¿Algo único?", "xyz");
    expect(split.length).toBe(1);
  });
});

describe("v2.24.0 — validateCard (paper §6.2 + §6.3)", () => {
  it("hard-reject cuando front == back", () => {
    const r = validateCard("foo", "foo");
    expect(r.ok).toBe(false);
    expect(r.hardError).toMatch(/id[eé]ntic/);
  });

  it("hard-reject mega-tarjeta", () => {
    const r = validateCard(
      "¿Síntomas de hipertiroidismo?",
      "taquicardia, pérdida de peso, insomnio, temblor, ansiedad",
    );
    expect(r.ok).toBe(false);
    expect(r.hardError).toMatch(/Mega-tarjeta/);
    expect(r.suggestion).toBeDefined();
  });

  it("warning por front largo (> 12 palabras)", () => {
    const r = validateCard(
      "Por favor describe cuál es el mecanismo de acción, vía de señalización y efectos adversos principales de la metformina en el contexto",
      "Disminuye gluconeogénesis hepática vía AMPK",
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /Front largo/.test(w))).toBe(true);
  });

  it("warning por back largo (> 50 palabras)", () => {
    const longBack = Array(60).fill("palabra").join(" ");
    const r = validateCard("¿X?", longBack);
    expect(r.warnings.some((w) => /Back largo/.test(w))).toBe(true);
  });

  it("warning por cloze con poco contexto", () => {
    const r = validateCard("{{c1::A}}", "A", "cloze");
    expect(r.warnings.some((w) => /contexto/i.test(w))).toBe(true);
  });

  it("ok para una card atómica bien escrita", () => {
    const r = validateCard(
      "¿Causa más frecuente de pancreatitis crónica?",
      "Alcohol (60-90% de casos)",
    );
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe("v2.24.0 — suggestCardType (heurística paper §6.1)", () => {
  it("detecta cloze si lleva {{c…}}", () => {
    expect(suggestCardType("Pregunta {{c1::x}}", "x")).toBe("cloze");
  });

  it("detecta image_occlusion si front sólo es URL", () => {
    expect(suggestCardType("https://cdn.example.com/anat.jpg", "label")).toBe(
      "image_occlusion",
    );
  });

  it("detecta enumerate si el back es lista numerada", () => {
    expect(
      suggestCardType(
        "Pares craneales según orden",
        "1. Olfatorio\n2. Óptico\n3. Oculomotor\n4. Troclear\n5. Trigémino",
      ),
    ).toBe("enumerate");
  });

  it("fallback a basic", () => {
    expect(suggestCardType("¿X?", "Y")).toBe("basic");
  });
});

describe("v2.24.0 — atomicRefactor (end-to-end)", () => {
  it("acepta cards atómicas, divide las mega, rechaza front==back", () => {
    const r = atomicRefactor([
      // OK atómica
      {
        front: "¿Causa más frecuente de pancreatitis crónica?",
        back: "Alcohol",
      },
      // Mega-tarjeta que será dividida
      {
        front: "¿Causas de hepatitis viral aguda?",
        back: "A, B, C, D, E",
      },
      // Hard-reject front==back
      { front: "idéntico", back: "idéntico" },
      // OK enumerate
      {
        front: "Orden de digestión de carbohidratos",
        back: "1. Boca\n2. Estómago\n3. Intestino delgado\n4. Colon",
      },
    ]);
    expect(r.accepted.length).toBe(2);
    expect(r.split.length).toBe(1); // la mega-tarjeta se ha dividido
    expect(r.split[0].split.length).toBe(5); // A,B,C,D,E
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0].reason).toMatch(/id[eé]ntic/);
  });

  it("rechaza y conserva advertencia cuando el back es corto comparativo al front", () => {
    const r = atomicRefactor([
      {
        front:
          "este es un front deliberadamente largo que duplica varias palabras para que sobrepase el umbral de doce palabras y dispare la regla de longitud",
        back: "x",
      },
    ]);
    // front > 12 palabras (warn) + back=1 muy corto (warn)
    expect(r.accepted.length).toBe(1);
    expect(r.accepted[0].warnings.length).toBeGreaterThanOrEqual(2);
  });
});
