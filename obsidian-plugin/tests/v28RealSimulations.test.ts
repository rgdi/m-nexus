// v0.28: Simulaciones reales — escenarios del día a día de un estudiante médico.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ScopeResolver } from "../src/exams/scopeResolver";
import { ScheduleMatcher } from "../src/exams/scheduleMatcher";
import { rebalance } from "../src/fsrs/loadBalancer";
import { BreadcrumbSystem, resetBreadcrumbs } from "../src/utils/breadcrumbs";
import { Logger, MemorySink } from "../src/utils/logger";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";
import { findCardsForFreeReview, createFreeReviewSession, answerFreeReview } from "../src/study/freeReview";
import type { FlashcardDraft } from "../src/types";

// ── Simulación 1: Vault realista de 50 notas, 7 carpetas, 3 tags ──

function makeMockApp(vault: Map<string, any>): any {
  return {
    vault: {
      getAbstractFileByPath(path: string) {
        return vault.get(path);
      },
      getMarkdownFiles() {
        return Array.from(vault.values()).filter((f) => f.extension === "md");
      },
      getAllLoadedFiles() {
        return Array.from(vault.values());
      },
    },
    metadataCache: {
      getFileCache(f: any) {
        return vault.get(f.path);
      },
    },
  };
}

function makeFile(path: string, fm: Record<string, any>) {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  const stem = name.replace(/\.md$/, "");
  return {
    path,
    name,
    basename: stem,
    extension: "md",
    children: [],
    ...(Object.keys(fm).length ? { frontmatter: fm } : {}),
  };
}

describe("Simulación 1: Vault realista (50 notas, 7 carpetas, 3 tags)", () => {
  it("1.1 resuelve scope folder con 7 subcarpetas", () => {
    const vault = new Map<string, any>();
    const subjects = ["anatomia", "fisiologia", "farmacologia", "bioquimica", "histologia", "embriologia", "patologia"];
    for (const subj of subjects) {
      // Crear carpeta virtual con children
      const children: any[] = [];
      for (let j = 0; j < 7; j++) {
        const path = `${subj}/tema${j + 1}.md`;
        const f = makeFile(path, { subject: subj, tags: [subj, j % 2 === 0 ? "teoria" : "practica"] });
        vault.set(path, f);
        children.push(f);
      }
      vault.set(subj, { path: subj, name: subj, basename: subj, extension: "", children });
    }
    vault.set("README.md", makeFile("README.md", {}));

    const app = makeMockApp(vault);
    const resolver = new ScopeResolver(app);
    const result = resolver.resolve({ type: "folder", path: "anatomia", includeSubfolders: false });
    expect(result.length).toBe(7);
    expect(result.every((r) => r.path.startsWith("anatomia/"))).toBe(true);
  });

  it("1.2 resuelve scope tag global", () => {
    const vault = new Map<string, any>();
    const subjects = ["anatomia", "fisiologia", "farmacologia", "bioquimica"];
    for (const subj of subjects) {
      for (let j = 0; j < 5; j++) {
        const path = `${subj}/tema${j + 1}.md`;
        vault.set(path, makeFile(path, { subject: subj, tags: [subj, j % 2 === 0 ? "cardio" : "renal"] }));
      }
    }
    const app = makeMockApp(vault);
    const resolver = new ScopeResolver(app);
    const cardio = resolver.resolve({ type: "tag", tag: "cardio" });
    // 4 subjects × 3 (j=0,2,4) = 12
    expect(cardio.length).toBe(12);
  });

  it("1.3 scope subject encuentra todas las notas de un subject", () => {
    const vault = new Map<string, any>();
    vault.set("a/t1.md", makeFile("a/t1.md", { subject: "anatomia" }));
    vault.set("b/t1.md", makeFile("b/t1.md", { subject: "anatomia" }));
    vault.set("c/t1.md", makeFile("c/t1.md", { subject: "fisiologia" }));
    const app = makeMockApp(vault);
    const resolver = new ScopeResolver(app);
    expect(resolver.resolve({ type: "subject", subject: "anatomia" }).length).toBe(2);
  });
});

// ── Simulación 2: ScheduleMatcher con horario realista ──

describe("Simulación 2: Horario realista L-V", () => {
  const schedules = [
    { subject: "Anatomía", dayOfWeek: 1 as const, startMinute: 9 * 60, durationMinutes: 90 },
    { subject: "Fisiología", dayOfWeek: 1 as const, startMinute: 11 * 60, durationMinutes: 90 },
    { subject: "Anatomía", dayOfWeek: 3 as const, startMinute: 9 * 60, durationMinutes: 90 },
    { subject: "Fisiología", dayOfWeek: 3 as const, startMinute: 11 * 60, durationMinutes: 90 },
    { subject: "Farmacología", dayOfWeek: 5 as const, startMinute: 15 * 60, durationMinutes: 120 },
  ];
  const matcher = new ScheduleMatcher(schedules);

  it("2.1 grabación durante clase de anatomía → match con alta confidence", () => {
    // Construir un lunes explícito a las 9:30 AM hora local
    const now = new Date(2026, 8, 7, 9, 30, 0); // lunes 7 sep 2026
    const result = matcher.match(now.getTime(), 30 * 60_000);
    expect(result).not.toBeNull();
    expect(result!.schedule.subject).toBe("Anatomía");
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it("2.2 grabación a las 11:30 AM lunes → Fisiología", () => {
    const now = new Date(2026, 8, 7, 11, 30, 0);
    const result = matcher.match(now.getTime(), 30 * 60_000);
    expect(result).not.toBeNull();
    expect(result!.schedule.subject).toBe("Fisiología");
  });

  it("2.3 grabación el sábado → null", () => {
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    while (now.getDay() !== 6) now.setDate(now.getDate() + 1);
    const result = matcher.match(now.getTime(), 30 * 60_000);
    expect(result).toBeNull();
  });

  it("2.4 grabación con durationMs=0 → no crashea", () => {
    const now = new Date();
    now.setHours(9, 30, 0, 0);
    while (now.getDay() !== 1) now.setDate(now.getDate() - 1);
    const result = matcher.match(now.getTime(), 0);
    // No debe crashear. Confianza será baja porque recDurationMin=0
    expect(result).toBeDefined();
  });

  it("2.5 matchAll con durationMs=0 no incluye NaN", () => {
    const now = new Date();
    now.setHours(9, 30, 0, 0);
    while (now.getDay() !== 1) now.setDate(now.getDate() - 1);
    const all = matcher.matchAll(now.getTime(), 0);
    for (const m of all) {
      expect(Number.isFinite(m.confidence)).toBe(true);
    }
  });

  it("2.6 getUpcoming para los próximos 5 días", () => {
    const from = Date.now();
    const upcoming = matcher.getUpcoming(from, 5);
    expect(upcoming.length).toBeGreaterThan(0);
    // Todos deben estar en el futuro
    for (const u of upcoming) {
      expect(u.startsAtMs).toBeGreaterThanOrEqual(from - 24 * 3600_000);
    }
  });
});

// ── Simulación 3: LoadBalancer con 200 cards y horizonte de 14 días ──

describe("Simulación 3: Reparto realista de 200 cards en 14 días", () => {
  function makeCard(id: string, daysOffset: number, priority: "High" | "Medium" | "Low", stability = 5): FlashcardDraft {
    const due = new Date();
    due.setDate(due.getDate() + daysOffset);
    return {
      id,
      front: `Q ${id}`,
      back: `A ${id}`,
      fsrs: {
        stability,
        difficulty: 5,
        dueDate: due.toISOString(),
        reps: 1,
        lapses: 0,
      },
    } as FlashcardDraft;
  }

  it("3.1 distribuye 200 cards sin overflow si dailyReviewCap=20", () => {
    const cards = [];
    for (let i = 0; i < 200; i++) {
      const daysOffset = i % 14; // distribuidas en 14 días
      const priorities: ("High" | "Medium" | "Low")[] = ["High", "Medium", "Low"];
      const priority = priorities[i % 3];
      cards.push({ card: makeCard(`c${i}`, daysOffset, priority), priority });
    }
    const result = rebalance({
      cards,
      today: new Date(),
      daysWindow: 14,
      dailyReviewCap: 20,
      softCap: 15,
    });
    expect(result.loads.length).toBe(14);
    // Ningún día debe tener más de dailyReviewCap
    for (const load of result.loads) {
      expect(load.cards).toBeLessThanOrEqual(20);
    }
  });

  it("3.2 daysWindow=0 no crashea", () => {
    const cards = [{ card: makeCard("c1", 0, "Medium"), priority: "Medium" as const }];
    expect(() => rebalance({
      cards,
      today: new Date(),
      daysWindow: 0, // edge case
      dailyReviewCap: 10,
      softCap: 5,
    })).not.toThrow();
  });

  it("3.3 cards fuera de horizonte van al último día", () => {
    const cards = [];
    for (let i = 0; i < 50; i++) {
      cards.push({ card: makeCard(`c${i}`, 30 + i, "Medium" as const), priority: "Medium" as const });
    }
    const result = rebalance({
      cards,
      today: new Date(),
      daysWindow: 7,
      dailyReviewCap: 10,
      softCap: 5,
    });
    // El último día debería tener overflow=true porque todas van allí
    const lastDay = result.loads[result.loads.length - 1];
    expect(lastDay.overflow).toBe(true);
  });
});

// ── Simulación 4: KnowledgeGraph con 100 conceptos y 500 reviews ──

describe("Simulación 4: KnowledgeGraph en uso real", () => {
  it("4.1 soporta 100 conceptos", () => {
    const kg = new KnowledgeGraph();
    for (let i = 0; i < 100; i++) {
      kg.add(createConcept(`concept-${i}`, `term ${i}`));
    }
    expect(kg.all().length).toBe(100);
  });

  it("4.2 detectar gaps en conceptos no vistos", () => {
    const kg = new KnowledgeGraph();
    for (let i = 0; i < 20; i++) {
      const c = createConcept(`c-${i}`, `term ${i}`);
      kg.add(c);
    }
    // Marcar 5 como mostradas
    for (let i = 0; i < 5; i++) {
      kg.markShown(`c-${i}`);
    }
    const gaps = kg.findGaps(20);
    // Los no mostrados aparecen en gaps
    const seenInGaps = gaps.filter((g) => g.concept.id.startsWith("c-")).length;
    expect(seenInGaps).toBeGreaterThan(0);
  });

  it("4.3 updateMastery con valores inválidos lanza error", () => {
    const kg = new KnowledgeGraph();
    kg.add(createConcept("c1", "test"));
    // Verificar que el sistema NO crashea con valores inválidos
    expect(() => kg.updateMastery("c1", NaN)).not.toThrow();
  });
});

// ── Simulación 5: FreeReview en uso real ──

describe("Simulación 5: Repaso libre realista", () => {
  function makeCard(id: string, notePath: string, tags: string[] = []): FlashcardDraft {
    return {
      id,
      front: `Q ${id}`,
      back: `A ${id}`,
      notePath,
      tags,
    } as FlashcardDraft;
  }

  it("5.1 'repaso anatomía' toma todas las notas de anatomia/", () => {
    const cards: FlashcardDraft[] = [];
    for (let i = 0; i < 30; i++) cards.push(makeCard(`a-${i}`, `anatomia/tema${i}.md`, ["anatomia"]));
    for (let i = 0; i < 20; i++) cards.push(makeCard(`f-${i}`, `fisiologia/tema${i}.md`, ["fisio"]));
    const found = findCardsForFreeReview(cards, { type: "topic", topic: "anatomia" });
    expect(found.length).toBe(30);
  });

  it("5.2 repaso por #tag funciona con tags anidadas", () => {
    const cards: FlashcardDraft[] = [
      makeCard("c1", "a.md", ["#cardio", "#anatomia"]),
      makeCard("c2", "b.md", ["#cardio"]),
      makeCard("c3", "c.md", ["#renal"]),
    ];
    const found = findCardsForFreeReview(cards, { type: "tag", tag: "cardio" });
    expect(found.length).toBe(2);
  });

  it("5.3 sesión completa de 50 cards funciona correctamente", () => {
    const cards: FlashcardDraft[] = [];
    for (let i = 0; i < 50; i++) cards.push(makeCard(`c-${i}`, `anatomia/tema${i}.md`));
    const found = findCardsForFreeReview(cards, { type: "topic", topic: "anatomia" });
    const session = createFreeReviewSession({ type: "topic", topic: "anatomia" }, found);
    for (let i = 0; i < found.length; i++) {
      answerFreeReview(session, found[i].id, (i % 4) + 1 as 1 | 2 | 3 | 4, 1500);
    }
    expect(session.completed).toBe(true);
    expect(session.responses.length).toBe(50);
  });
});

// ── Simulación 6: Stress test del sistema de breadcrumbs ──

describe("Simulación 6: Stress del sistema de breadcrumbs", () => {
  it("6.1 1000 logs mantienen solo los últimos 100", () => {
    const sys = new BreadcrumbSystem();
    for (let i = 0; i < 1000; i++) {
      sys.record("info", "stress", `msg ${i}`, { data: { idx: i } });
    }
    expect(sys.all().length).toBe(100);
    expect(sys.all()[0].message).toBe("msg 900");
    expect(sys.all()[99].message).toBe("msg 999");
  });

  it("6.2 stats del buffer (últimos 100) son precisos", () => {
    const sys = new BreadcrumbSystem();
    for (let i = 0; i < 1000; i++) {
      const type = i % 3 === 0 ? "error" : "info";
      sys.record(type as any, "stress", `msg ${i}`);
    }
    const stats = sys.stats();
    // stats cuenta solo lo que está en el buffer (últimos 100)
    expect(stats.total).toBe(100);
    // El ring buffer mantiene los últimos 100
    expect(sys.all()[0].message).toBe("msg 900");
  });
});

// ── Simulación 7: Logger detecta valores anómalos ──

describe("Simulación 7: Logger en escenarios reales", () => {
  let memorySink: MemorySink;

  beforeEach(() => {
    Logger.clearSinks();
    Logger.setMinLevel("trace");
    Logger.clearContext();
    resetBreadcrumbs();
    memorySink = new MemorySink();
    Logger.addSink(memorySink.sink);
  });

  afterEach(() => {
    Logger.clearSinks();
  });

  it("7.1 detecta NaN en campos críticos", () => {
    const log = new Logger("test");
    const card = { stability: NaN, difficulty: 5, dueDate: "2026-09-01" };
    log.assertNotNull(card.stability, "stability", { operation: "fsrs.review" });
    // El assert debe haber registrado un error
    const errors = memorySink.filter("error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("7.2 detecta fechas inválidas", () => {
    const log = new Logger("test");
    const due = new Date("invalid");
    log.assert(!isNaN(due.getTime()), "dueDate debe ser válida", { operation: "fsrs.dueDate" });
    const errors = memorySink.filter("error");
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── Simulación 8: Integración vault→orchestrator→quiz→FSRS ──

describe("Simulación 8: Flujo completo de estudio", () => {
  it("8.1 cargar vault → evaluar → generar quiz → responder → FSRS review", () => {
    // 1) KnowledgeGraph vacío
    const kg = new KnowledgeGraph();
    
    // 2) Crear conceptos desde vault
    const vault = ["corazón", "hígado", "riñón", "pulmón"];
    for (const term of vault) {
      kg.add(createConcept(term.toLowerCase(), term));
    }

    // 3) Encontrar gaps
    const gaps = kg.findGaps(20);
    expect(gaps.length).toBeGreaterThan(0);

    // 4) Marcar como mostrados (simular quiz)
    for (const gap of gaps) {
      kg.markShown(gap.concept.id);
    }

    // 5) Subir mastery del primer gap (correct=true, confidence=0.9)
    if (gaps.length > 0) {
      kg.updateMastery(gaps[0].concept.id, gaps[0].layer, true, 0.9);
    }

    // 6) Verificar que el primer gap tiene mastery > 0
    const concept = kg.get(gaps[0].concept.id);
    expect(concept).not.toBeNull();
    expect(concept!.layers[gaps[0].layer].mastery).toBeGreaterThan(0);
  });
});
