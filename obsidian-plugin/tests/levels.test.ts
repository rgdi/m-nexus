import { describe, it, expect } from "vitest";
import {
  getLevelInfo,
  listAllLevels,
  nextLevel,
  previousLevel,
  ACADEMIC_LEVELS,
} from "../src/levels/taxonomy";
import { buildLevelBlock, buildInjectedContext, injectLevel, prependLevelToUser } from "../src/levels/levelInjector";
import { LevelPromoter } from "../src/levels/levelPromoter";
import { LevelDetector } from "../src/levels/levelDetector";
import { FSRSCardSnapshot } from "../src/analytics/metrics";
import { makeMockApp, MockApp } from "./mockObsidian";
import { noopLogger } from "./helpers";
import { MNexusSettings, LLMMessage, AcademicLevel } from "../src/types";

// ─── taxonomy ────────────────────────────────────────────────────────

describe("taxonomy", () => {
  it("tiene 7 niveles (1-6 MED + custom)", () => {
    expect(ACADEMIC_LEVELS.length).toBe(7);
  });

  it("getLevelInfo devuelve info válida para cada nivel", () => {
    for (const l of ACADEMIC_LEVELS) {
      const info = getLevelInfo(l.id);
      expect(info.id).toBe(l.id);
      expect(info.label).toBeTruthy();
      expect(info.year).toBeGreaterThanOrEqual(0);
    }
  });

  it("getLevelInfo(null) devuelve 1_MED por defecto", () => {
    expect(getLevelInfo(null).id).toBe("1_MED");
  });

  it("getLevelInfo('unknown') devuelve custom", () => {
    expect(getLevelInfo("xyz" as never).id).toBe("custom");
  });

  it("nextLevel avanza correctamente", () => {
    expect(nextLevel("1_MED")).toBe("2_MED");
    expect(nextLevel("3_MED")).toBe("4_MED");
    expect(nextLevel("5_MED")).toBe("6_MED_MIR");
    expect(nextLevel("6_MED_MIR")).toBe(null);
    expect(nextLevel("custom")).toBe(null);
  });

  it("previousLevel retrocede correctamente", () => {
    expect(previousLevel("2_MED")).toBe("1_MED");
    expect(previousLevel("1_MED")).toBe(null);
    expect(previousLevel("custom")).toBe(null);
  });

  it("listAllLevels() devuelve copia", () => {
    const a = listAllLevels();
    const b = listAllLevels();
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
  });

  it("cada nivel no-custom tiene prompt", () => {
    for (const l of ACADEMIC_LEVELS) {
      if (l.id === "custom") continue;
      expect(l.prompt.length).toBeGreaterThan(50);
    }
  });

  it("vocabulario de 1_MED es molecular/celular, no clínico", () => {
    const v = getLevelInfo("1_MED").vocabulary.join(" ").toLowerCase();
    expect(v).toMatch(/orgánulo|enzima|mitocondria|golgi/i);
    expect(v).not.toMatch(/síndrome|diagnóstico|comorbilidad/i);
  });

  it("vocabulario de 4_MED es clínico, no molecular", () => {
    const v = getLevelInfo("4_MED").vocabulary.join(" ").toLowerCase();
    expect(v).toMatch(/comorbilidad|escala|screening/i);
  });
});

// ─── injector ────────────────────────────────────────────────────────

describe("levelInjector", () => {
  it("buildLevelBlock devuelve string vacío si levelAware=false", () => {
    expect(buildLevelBlock("1_MED", false)).toBe("");
  });

  it("buildLevelBlock devuelve string vacío para custom", () => {
    expect(buildLevelBlock("custom", true)).toBe("");
  });

  it("buildLevelBlock devuelve prompt para 1_MED", () => {
    const block = buildLevelBlock("1_MED", true);
    expect(block).toContain("MOLECULAR");
    expect(block).toContain("orgánulo");
  });

  it("injectLevel añade bloque al primer system message", () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "SISTEMA BASE" },
      { role: "user", content: "PREGUNTA" },
    ];
    const out = injectLevel(messages, "1_MED", true);
    expect(out[0].role).toBe("system");
    expect(out[0].content).toContain("SISTEMA BASE");
    expect(out[0].content).toContain("MOLECULAR");
  });

  it("injectLevel crea system message si no existía", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "PREGUNTA" }];
    const out = injectLevel(messages, "1_MED", true);
    expect(out[0].role).toBe("system");
    expect(out[0].content).toContain("MOLECULAR");
  });

  it("injectLevel no muta el array original", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "P" }];
    const before = messages[0].content;
    injectLevel(messages, "1_MED", true);
    expect(messages[0].content).toBe(before);
  });

  it("buildInjectedContext devuelve level y systemBlock", () => {
    const ctx = buildInjectedContext("3_MED", true);
    expect(ctx.level).toBe("3_MED");
    expect(ctx.systemBlock).toContain("PATOLOG");
  });

  it("prependLevelToUser no hace nada si levelAware=false", () => {
    const r = prependLevelToUser("hola", "1_MED", false);
    expect(r).toBe("hola");
  });

  it("prependLevelToUser añade prefijo", () => {
    const r = prependLevelToUser("hola", "1_MED", true);
    expect(r).toContain("1º");
    expect(r).toContain("hola");
  });
});

// ─── promoter ────────────────────────────────────────────────────────

describe("LevelPromoter", () => {
  function makePromoter(minStab = 60, minRatio = 0.7): LevelPromoter {
    return new LevelPromoter(
      {
        userLevel: "1_MED",
        levelPromotionStability: minStab,
        levelPromotionMinRatio: minRatio,
      } as MNexusSettings,
      noopLogger
    );
  }

  function makeCard(over: Partial<FSRSCardSnapshot> = {}): FSRSCardSnapshot {
    return {
      id: "c1",
      subject: "test",
      stability: 30,
      difficulty: 5,
      dueDate: "2025-01-01",
      state: "review",
      lapses: 0,
      reps: 5,
      ...over,
    };
  }

  it("sin tarjetas: no recomienda", () => {
    const p = makePromoter();
    const s = p.evaluate([]);
    expect(s.recommended).toBe(false);
    expect(s.reviewCount).toBe(0);
  });

  it("tarjetas muy inmaduras: no recomienda", () => {
    const p = makePromoter();
    const s = p.evaluate([
      makeCard({ state: "review", stability: 5 }),
      makeCard({ state: "review", stability: 5 }),
      makeCard({ state: "review", stability: 5 }),
    ]);
    expect(s.recommended).toBe(false);
    expect(s.avgStability).toBe(5);
  });

  it("tarjetas estables: recomienda subir", () => {
    const p = makePromoter();
    const cards = Array.from({ length: 10 }, () => makeCard({ state: "review", stability: 90 }));
    const s = p.evaluate(cards);
    expect(s.recommended).toBe(true);
    expect(s.suggestedLevel).toBe("2_MED");
    expect(s.stableRatio).toBe(1);
  });

  it("6_MED_MIR no tiene siguiente", () => {
    const p = new LevelPromoter(
      { userLevel: "6_MED_MIR", levelPromotionStability: 60, levelPromotionMinRatio: 0.7 } as MNexusSettings,
      noopLogger
    );
    const cards = Array.from({ length: 10 }, () => makeCard({ state: "review", stability: 90 }));
    const s = p.evaluate(cards);
    expect(s.recommended).toBe(false);
    expect(s.suggestedLevel).toBe(null);
  });

  it("custom no tiene siguiente", () => {
    const p = new LevelPromoter(
      { userLevel: "custom", levelPromotionStability: 60, levelPromotionMinRatio: 0.7 } as MNexusSettings,
      noopLogger
    );
    const cards = Array.from({ length: 10 }, () => makeCard({ state: "review", stability: 90 }));
    const s = p.evaluate(cards);
    expect(s.suggestedLevel).toBe(null);
  });

  it("mezcla estable/inestable: ratio parcial", () => {
    const p = makePromoter();
    const cards = [
      ...Array.from({ length: 7 }, () => makeCard({ state: "review", stability: 90 })),
      ...Array.from({ length: 3 }, () => makeCard({ state: "review", stability: 5 })),
    ];
    const s = p.evaluate(cards);
    expect(s.stableRatio).toBe(0.7);
    // Estab media: (7*90 + 3*5)/10 = 64.5, por encima de 60
    expect(s.avgStability).toBe(64.5);
    expect(s.recommended).toBe(true);
  });

  it("ignora tarjetas no en review", () => {
    const p = makePromoter();
    const s = p.evaluate([
      makeCard({ state: "new", stability: 9999 }),
      makeCard({ state: "learning", stability: 9999 }),
      makeCard({ state: "lapsed", stability: 9999 }),
    ]);
    expect(s.reviewCount).toBe(0);
  });
});

// ─── detector ─────────────────────────────────────────────────────────

describe("LevelDetector (smoke)", () => {
  let app: MockApp;
  beforeEach(() => {
    app = makeMockApp({
      "Bioquímica/Glucólisis.md": "---\nlevel: 1_MED\nsubject: Bioquímica\n---\n# Glucólisis",
      "Patología/Neumonía.md": "---\nlevel: 3_MED\nsubject: Patología\n---\n# Neumonía",
      "Sin nivel.md": "# Nota sin level en frontmatter",
      "MIR/USMLE Step 1.md": "---\nlevel: 6_MED_MIR\n---\n# USMLE",
    });
  });

  it("lee level del frontmatter", async () => {
    const d = new LevelDetector(app as never, { userLevel: "1_MED" } as MNexusSettings, noopLogger);
    expect(await d.readFromFrontmatter("Bioquímica/Glucólisis.md")).toBe("1_MED");
    expect(await d.readFromFrontmatter("Patología/Neumonía.md")).toBe("3_MED");
    expect(await d.readFromFrontmatter("MIR/USMLE Step 1.md")).toBe("6_MED_MIR");
  });

  it("devuelve null si no hay level", async () => {
    const d = new LevelDetector(app as never, { userLevel: "1_MED" } as MNexusSettings, noopLogger);
    expect(await d.readFromFrontmatter("Sin nivel.md")).toBe(null);
  });

  it("resolveForNote cae al settings si no hay level", async () => {
    const d = new LevelDetector(app as never, { userLevel: "2_MED" } as MNexusSettings, noopLogger);
    expect(await d.resolveForNote("Sin nivel.md")).toBe("2_MED");
  });

  it("resolveForNote usa heurística si no hay frontmatter", async () => {
    const d = new LevelDetector(app as never, { userLevel: "1_MED" } as MNexusSettings, noopLogger);
    const heur = await d.resolveForNote("Histología - Tejido Muscular.md");
    expect(["1_MED", "2_MED"]).toContain(heur); // histología es 1_MED pero puede matchear 2_MED
  });
});
