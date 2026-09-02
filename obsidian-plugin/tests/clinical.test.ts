import { describe, it, expect } from "vitest";
import { VignetteGenerator, Vignette } from "../src/clinical/vignetteGenerator";
import { SocraticTutor } from "../src/clinical/socratic";
import { LLMManager } from "../src/llm/manager";
import { makeMockApp, MockApp } from "./mockObsidian";
import { noopLogger } from "./helpers";

// ─── Fixtures ──────────────────────────────────────────────────────────

function llmNoDisponible(): LLMManager {
  // Mock mínimo: solo lo que usan vignetteGenerator y socratic
  return {
    isAvailable: () => false,
    getProvider: () => {
      throw new Error("no provider");
    },
  } as unknown as LLMManager;
}

// ─── VignetteGenerator ────────────────────────────────────────────────

describe("VignetteGenerator", () => {
  let app: MockApp;
  beforeEach(() => {
    app = makeMockApp({
      "Cardio/ICC.md": "---\nsubject: Cardio\n---\n# Insuficiencia Cardíaca\nConceptos clave: gasto cardíaco, precarga, poscarga.",
    });
  });

  it("genera esqueleto cuando no hay LLM", async () => {
    const gen = new VignetteGenerator(app as never, llmNoDisponible(), noopLogger);
    const v = await gen.generate({ notePath: "Cardio/ICC.md", style: "usmle" });
    expect(v.style).toBe("usmle");
    expect(v.pathology).toBe("ICC");
    expect(v.options.length).toBe(5);
    expect(v.tags).toContain("usmle");
    expect(v.tags).toContain("esqueleto");
  });

  it("soporta todos los estilos", async () => {
    const gen = new VignetteGenerator(app as never, llmNoDisponible(), noopLogger);
    for (const style of ["usmle", "mir", "osce", "case-presentation"] as const) {
      const v = await gen.generate({ notePath: "Cardio/ICC.md", style });
      expect(v.style).toBe(style);
    }
  });

  it("lanza error si la nota no existe", async () => {
    const gen = new VignetteGenerator(app as never, llmNoDisponible(), noopLogger);
    await expect(gen.generate({ notePath: "nope.md", style: "usmle" })).rejects.toThrow();
  });
});

// ─── Validación de la estructura ──────────────────────────────────────

describe("Vignette shape", () => {
  it("la opción correcta tiene isCorrect=true", () => {
    const v: Vignette = {
      style: "usmle",
      pathology: "X",
      presentation: "",
      question: "?",
      options: [
        { letter: "A", text: "A", isCorrect: true },
        { letter: "B", text: "B", isCorrect: false },
      ],
      correctAnswer: { letter: "A", explanation: "" },
      difficulty: 3,
      tags: [],
      generatedAt: new Date().toISOString(),
      sourceNote: "x.md",
    };
    const correct = v.options.find((o) => o.isCorrect);
    expect(correct?.letter).toBe("A");
  });
});

// ─── SocraticTutor (sin LLM → solo testea isAvailable) ───────────────

describe("SocraticTutor", () => {
  it("isAvailable refleja el LLM", () => {
    const app = makeMockApp();
    const tutor = new SocraticTutor(app as never, llmNoDisponible(), noopLogger);
    expect(tutor.isAvailable()).toBe(false);
  });

  it("startSession sin LLM devuelve mensaje de error", async () => {
    const app = makeMockApp();
    const tutor = new SocraticTutor(app as never, llmNoDisponible(), noopLogger);
    const session = await tutor.startSession({ notePath: "x.md", pathology: "X" });
    expect(session.turns.length).toBe(1);
    expect(session.turns[0].role).toBe("tutor");
    expect(session.turns[0].content).toContain("LLM");
  });
});
