// v0.28: Tests del sistema de caja negra (breadcrumbs) + Repaso Libre.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Logger, MemorySink } from "../src/utils/logger";
import { BreadcrumbSystem, getBreadcrumbs, resetBreadcrumbs } from "../src/utils/breadcrumbs";
import {
  findCardsForFreeReview,
  createFreeReviewSession,
  answerFreeReview,
  finishFreeReview,
  parseFreeReviewInput,
  describeFreeReviewSource,
  type FlashcardDraft,
} from "../src/study/freeReview";

// ── Blackbox / Breadcrumbs ──

describe("BreadcrumbSystem: caja negra", () => {
  beforeEach(() => {
    resetBreadcrumbs();
  });

  it("1.1 registra breadcrumbs con timestamp y tipo", () => {
    const sys = new BreadcrumbSystem();
    const bc = sys.record("info", "vault", "Snapshot built", { data: { count: 10 } });
    expect(bc.id).toBe(1);
    expect(bc.type).toBe("info");
    expect(bc.category).toBe("vault");
    expect(bc.message).toBe("Snapshot built");
    expect(bc.timestamp).toBeGreaterThan(0);
  });

  it("1.2 ring buffer descarta los más viejos", () => {
    const sys = new BreadcrumbSystem();
    for (let i = 0; i < 150; i++) {
      sys.record("info", "test", `msg ${i}`);
    }
    const all = sys.all();
    expect(all.length).toBe(100); // MAX_BREADCRUMBS = 100
    expect(all[0].message).toBe("msg 50"); // primeros 50 descartados
    expect(all[99].message).toBe("msg 149");
  });

  it("1.3 stats por tipo y categoría", () => {
    const sys = new BreadcrumbSystem();
    sys.record("info", "vault", "1");
    sys.record("info", "vault", "2");
    sys.record("warn", "fsrs", "low retention");
    sys.record("error", "ai", "timeout");
    const stats = sys.stats();
    expect(stats.total).toBe(4);
    expect(stats.byType.info).toBe(2);
    expect(stats.byType.warn).toBe(1);
    expect(stats.byType.error).toBe(1);
    expect(stats.byCategory.vault).toBe(2);
    expect(stats.byCategory.fsrs).toBe(1);
    expect(stats.byCategory.ai).toBe(1);
  });

  it("1.4 blackbox incluye correlationId y contexto", () => {
    const sys = new BreadcrumbSystem();
    sys.setCorrelationId("req-123");
    sys.setContext({ userId: "u1" });
    sys.record("info", "vault", "1");
    sys.record("error", "ai", "fail");
    const box = sys.getBlackBox();
    expect(box.correlationId).toBe("req-123");
    expect(box.context.userId).toBe("u1");
    expect(box.breadcrumbs.length).toBe(2);
  });
});

// ── Logger incluye caja negra en errors ──

describe("Logger incluye caja negra en errors", () => {
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

  it("2.1 error incluye últimos breadcrumbs en blackbox", () => {
    const log = new Logger("test");
    // Simular operaciones previas
    log.info("vault eval started");
    log.debug("reading snapshots");
    log.info("snapshots read", { operation: "vault.eval", data: { count: 10 } });
    log.warn("low retention on card X");
    log.error("FSRS review failed", { operation: "fsrs.review", error: new Error("timeout") });

    const errorEntry = memorySink.filter("error")[0];
    expect(errorEntry.blackbox).toBeDefined();
    expect(errorEntry.blackbox!.breadcrumbs.length).toBeGreaterThan(0);
    // Los últimos breadcrumbs (excluyendo el error actual) deben estar
    const messages = errorEntry.blackbox!.breadcrumbs.map((b) => b.message);
    expect(messages).toContain("vault eval started");
    expect(messages).toContain("low retention on card X");
  });

  it("2.2 fatal también incluye blackbox", () => {
    const log = new Logger("test");
    log.info("op1");
    log.fatal("catastrophic", { error: new Error("disk full") });

    const fatals = memorySink.entries.filter((e) => e.level === "fatal");
    expect(fatals.length).toBe(1);
    expect(fatals[0].blackbox).toBeDefined();
    expect(fatals[0].blackbox!.breadcrumbs.some((b) => b.message === "op1")).toBe(true);
  });

  it("2.3 info NO incluye blackbox (solo errors)", () => {
    const log = new Logger("test");
    log.info("just info");
    expect(memorySink.entries[0].blackbox).toBeUndefined();
  });

  it("2.4 blackbox tiene límite de 20 breadcrumbs", () => {
    const log = new Logger("test");
    for (let i = 0; i < 50; i++) log.info(`msg ${i}`);
    log.error("final error");
    const errorEntry = memorySink.filter("error")[0];
    expect(errorEntry.blackbox!.breadcrumbs.length).toBeLessThanOrEqual(20);
  });

  it("2.5 blackbox preserva variables y data de cada breadcrumb", () => {
    const log = new Logger("test");
    log.info("snapshots read", { operation: "vault.eval", data: { count: 10, file: "x.md" } });
    log.error("fail", { error: new Error("e") });
    const errorEntry = memorySink.filter("error")[0];
    const bc = errorEntry.blackbox!.breadcrumbs[0];
    expect(bc.data).toEqual({ count: 10, file: "x.md" });
  });
});

// ── Repaso libre (Free Review) ──

function makeCard(id: string, notePath: string, tags: string[] = [], stability: number = 0): FlashcardDraft {
  return {
    id,
    front: `Q ${id}`,
    back: `A ${id}`,
    notePath,
    tags,
    fsrs: { stability, difficulty: 5, dueDate: new Date().toISOString(), reps: 0, lapses: 0 },
  } as FlashcardDraft;
}

describe("FreeReview: repasar lo que TÚ quieras sin FSRS", () => {
  const cards: FlashcardDraft[] = [
    makeCard("c1", "anatomia/corazon.md", ["cardio"]),
    makeCard("c2", "anatomia/higado.md", ["anatomia"]),
    makeCard("c3", "fisiologia/sangre.md", ["fisio"]),
    makeCard("c4", "fisiologia/respiracion.md", ["fisio"]),
    makeCard("c5", "anatomia/huesos.md", ["anatomia"]),
    makeCard("c6", "farmacologia/aspirina.md", ["farma"]),
  ];

  it("3.1 busca por topic (substring en notePath)", () => {
    const found = findCardsForFreeReview(cards, { type: "topic", topic: "anatomia" });
    expect(found.length).toBe(3);
    expect(found.map((c) => c.id).sort()).toEqual(["c1", "c2", "c5"]);
  });

  it("3.2 busca por folder", () => {
    const found = findCardsForFreeReview(cards, { type: "folder", folder: "fisiologia" });
    expect(found.length).toBe(2);
  });

  it("3.3 busca por tag", () => {
    const found = findCardsForFreeReview(cards, { type: "tag", tag: "cardio" });
    expect(found.length).toBe(1);
    expect(found[0].id).toBe("c1");
  });

  it("3.4 aleatorio: N cards", () => {
    const found = findCardsForFreeReview(cards, { type: "random", count: 3 });
    expect(found.length).toBe(3);
  });

  it("3.5 stale: cards sin revisar hace N días", () => {
    const oldCard = makeCard("old", "old.md");
    const oldDate = new Date(Date.now() - 10 * 86400000).toISOString();
    (oldCard.fsrs as any).lastReview = oldDate;
    const newCard = makeCard("new", "new.md");
    (newCard.fsrs as any).lastReview = new Date().toISOString();
    const found = findCardsForFreeReview([oldCard, newCard], { type: "stale", days: 7 });
    expect(found.length).toBe(1);
    expect(found[0].id).toBe("old");
  });

  it("3.6 all: todas las cards", () => {
    const found = findCardsForFreeReview(cards, { type: "all" });
    expect(found.length).toBe(cards.length);
  });

  it("3.7 custom: IDs específicos", () => {
    const found = findCardsForFreeReview(cards, { type: "custom", cardIds: ["c1", "c3"] });
    expect(found.length).toBe(2);
  });

  it("3.8 baraja por defecto (shuffle=true)", () => {
    const runs: string[][] = [];
    for (let i = 0; i < 5; i++) {
      const found = findCardsForFreeReview(cards, { type: "all" });
      runs.push(found.map((c) => c.id));
    }
    // No todas las ejecuciones deberían ser idénticas (probabilistic test)
    const identical = runs.every((r) => JSON.stringify(r) === JSON.stringify(runs[0]));
    expect(identical).toBe(false);
  });

  it("3.9 maxCards limita resultados", () => {
    const found = findCardsForFreeReview(cards, { type: "all" }, { maxCards: 2 });
    expect(found.length).toBe(2);
  });

  it("3.10 includeMastered=false filtra cards con stability >= 21", () => {
    const mastered = makeCard("m", "m.md", [], 25);
    const fresh = makeCard("f", "f.md", [], 5);
    const found = findCardsForFreeReview([mastered, fresh], { type: "all" }, { includeMastered: false });
    expect(found.length).toBe(1);
    expect(found[0].id).toBe("f");
  });
});

// ── Sesión de repaso ──

describe("FreeReview: sesión completa", () => {
  it("4.1 crea sesión con cards y source", () => {
    const session = createFreeReviewSession({ type: "topic", topic: "x" }, [makeCard("c1", "x.md")]);
    expect(session.id).toMatch(/^frs_/);
    expect(session.source.type).toBe("topic");
    expect(session.cards.length).toBe(1);
    expect(session.completed).toBe(false);
  });

  it("4.2 responder marca respuesta y avanza", () => {
    const session = createFreeReviewSession({ type: "all" }, [
      makeCard("c1", "a.md"),
      makeCard("c2", "b.md"),
    ]);
    answerFreeReview(session, "c1", 3, 1000);
    expect(session.responses.length).toBe(1);
    expect(session.currentIndex).toBe(1);
    expect(session.completed).toBe(false);
  });

  it("4.3 completar cuando currentIndex >= cards.length", () => {
    const session = createFreeReviewSession({ type: "all" }, [makeCard("c1", "a.md")]);
    answerFreeReview(session, "c1", 4, 500);
    expect(session.completed).toBe(true);
  });

  it("4.4 finishFreeReview calcula stats", () => {
    const session = createFreeReviewSession({ type: "all" }, [
      makeCard("c1", "a.md"),
      makeCard("c2", "b.md"),
      makeCard("c3", "c.md"),
      makeCard("c4", "d.md"),
    ]);
    answerFreeReview(session, "c1", 1, 1000); // Again
    answerFreeReview(session, "c2", 3, 2000); // Good
    answerFreeReview(session, "c3", 4, 3000); // Easy
    answerFreeReview(session, "c4", 3, 4000); // Good
    const result = finishFreeReview(session);
    expect(result.total).toBe(4);
    expect(result.correct).toBe(3); // 3 o 4 son correctas
    expect(result.accuracy).toBe(0.75);
    expect(result.byRating[1]).toBe(1);
    expect(result.byRating[3]).toBe(2);
    expect(result.byRating[4]).toBe(1);
    expect(result.averageTimeMs).toBe(2500);
  });
});

// ── Parser de input libre ──

describe("FreeReview: parse input", () => {
  it("5.1 'anatomía' → topic", () => {
    const s = parseFreeReviewInput("anatomía");
    expect(s).toEqual({ type: "topic", topic: "anatomía" });
  });

  it("5.2 '#cardio' → tag", () => {
    const s = parseFreeReviewInput("#cardio");
    expect(s).toEqual({ type: "tag", tag: "#cardio" });
  });

  it("5.3 'anatomia/' → folder", () => {
    const s = parseFreeReviewInput("anatomia/");
    expect(s).toEqual({ type: "folder", folder: "anatomia/" });
  });

  it("5.4 'stale:7' → 7 días sin ver", () => {
    const s = parseFreeReviewInput("stale:7");
    expect(s).toEqual({ type: "stale", days: 7 });
  });

  it("5.5 'aleatorio' → random 30", () => {
    const s = parseFreeReviewInput("aleatorio");
    expect(s).toEqual({ type: "random", count: 30 });
  });

  it("5.6 'todas' → all", () => {
    const s = parseFreeReviewInput("todas");
    expect(s).toEqual({ type: "all" });
  });

  it("5.7 '' → all (default)", () => {
    const s = parseFreeReviewInput("");
    expect(s).toEqual({ type: "all" });
  });

  it("5.8 'hace 14 días' → stale 14", () => {
    const s = parseFreeReviewInput("hace 14 días");
    expect(s).toEqual({ type: "stale", days: 14 });
  });
});

describe("FreeReview: describe source", () => {
  it("6.1 describe cada tipo correctamente", () => {
    expect(describeFreeReviewSource({ type: "topic", topic: "anatomía" })).toBe('tema "anatomía"');
    expect(describeFreeReviewSource({ type: "folder", folder: "x/" })).toBe('carpeta "x/"');
    expect(describeFreeReviewSource({ type: "tag", tag: "cardio" })).toBe('tag "cardio"');
    expect(describeFreeReviewSource({ type: "random", count: 10 })).toBe("10 aleatorias");
    expect(describeFreeReviewSource({ type: "stale", days: 7 })).toBe("sin ver hace 7 días");
    expect(describeFreeReviewSource({ type: "all" })).toBe("todas");
    expect(describeFreeReviewSource({ type: "custom", cardIds: ["a", "b"] })).toBe("2 específicas");
  });
});

// ── Escenarios realistas ──

describe("FreeReview: escenarios del día a día", () => {
  const allCards: FlashcardDraft[] = [
    makeCard("c1", "anatomia/corazon.md", ["cardio", "anatomia"]),
    makeCard("c2", "anatomia/higado.md", ["anatomia"]),
    makeCard("c3", "anatomia/huesos.md", ["anatomia"]),
    makeCard("c4", "fisiologia/sangre.md", ["fisio"]),
    makeCard("c5", "farmacologia/aspirina.md", ["farma"]),
    makeCard("c6", "fisiologia/respiracion.md", ["fisio"]),
    makeCard("c7", "cardio/hipertension.md", ["cardio"]),
  ];

  it("7.1 'Hoy me apetece repasar anatomía'", () => {
    const source = parseFreeReviewInput("anatomia");
    const cards = findCardsForFreeReview(allCards, source);
    expect(cards.length).toBe(3); // corazon, higado, huesos
  });

  it("7.2 'Repasemos cardiología' (por tag)", () => {
    const source = parseFreeReviewInput("#cardio");
    const cards = findCardsForFreeReview(allCards, source);
    expect(cards.length).toBe(2);
  });

  it("7.3 sesión completa: input → preview → quiz → resultados", () => {
    // Paso 1: parse
    const source = parseFreeReviewInput("anatomia");
    // Paso 2: find
    const cards = findCardsForFreeReview(allCards, source);
    // Paso 3: session
    const session = createFreeReviewSession(source, cards);
    // Paso 4: responder todas
    for (const card of cards) {
      answerFreeReview(session, card.id, 3, 1500);
    }
    // Paso 5: finalizar
    const result = finishFreeReview(session);
    expect(result.total).toBe(cards.length);
    expect(result.accuracy).toBe(1.0);
    expect(session.completed).toBe(true);
  });

  it("7.4 repaso libre NO modifica FSRS", () => {
    const card = makeCard("c1", "x.md", [], 5);
    const initialStability = card.fsrs!.stability;
    const source = parseFreeReviewInput("x");
    const cards = findCardsForFreeReview([card], source);
    const session = createFreeReviewSession(source, cards);
    answerFreeReview(session, "c1", 1, 1000); // user fails
    // La stability DEBE seguir igual (free review no toca FSRS)
    expect(card.fsrs!.stability).toBe(initialStability);
  });
});
