// v0.28: Tests del sistema de Snooze.

import { describe, it, expect, beforeEach } from "vitest";
import {
  SnoozeManager,
  parseHumanDuration,
  formatHumanDuration,
  formatExpiry,
  DEFAULT_SNOOZE_CONFIG,
  type SnoozeEntry,
  type SnoozePersistence,
} from "../src/study/snooze";
import {
  filterSnoozedFlashcards,
  getDueCardsExcludingSnoozed,
  countSnoozedImpact,
} from "../src/study/snoozeIntegration";
import type { FlashcardDraft } from "../src/types";

// ── Mock persistence ──

class MockPersistence implements SnoozePersistence {
  private data: SnoozeEntry[] = [];
  load() { return [...this.data]; }
  save(entries: SnoozeEntry[]) { this.data = [...entries]; }
}

// ── SnoozeManager básico ──

describe("SnoozeManager: API básica", () => {
  let manager: SnoozeManager;
  let persistence: MockPersistence;

  beforeEach(() => {
    persistence = new MockPersistence();
    manager = new SnoozeManager(persistence);
  });

  it("1.1 snoozear un elemento por 7 días", () => {
    const entry = manager.snooze("flashcard", "c1", "Card 1", { durationMs: 7 * 24 * 3600_000 });
    expect(entry.id).toMatch(/^snooze_/);
    expect(entry.type).toBe("flashcard");
    expect(entry.targetId).toBe("c1");
    expect(entry.expiresAt).not.toBeNull();
  });

  it("1.2 snoozear indefinidamente (durationMs=null)", () => {
    const entry = manager.snooze("flashcard", "c1", "Card 1", { durationMs: null });
    expect(entry.expiresAt).toBeNull();
  });

  it("1.3 isSnoozed retorna true durante el periodo", () => {
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: 24 * 3600_000 });
    expect(manager.isSnoozed("flashcard", "c1")).toBe(true);
  });

  it("1.4 isSnoozed retorna false cuando expira", () => {
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: -1 }); // ya expirado
    expect(manager.isSnoozed("flashcard", "c1")).toBe(false);
  });

  it("1.5 snoozear el mismo elemento dos veces reemplaza", () => {
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: 1000 });
    manager.snooze("flashcard", "c1", "Card 1 (actualizado)", { durationMs: 2000 });
    const list = manager.list();
    expect(list.length).toBe(1);
    expect(list[0].targetName).toBe("Card 1 (actualizado)");
  });

  it("1.6 unsnooze quita el snooze", () => {
    manager.snooze("flashcard", "c1", "Card 1");
    expect(manager.unsnooze("flashcard", "c1")).toBe(true);
    expect(manager.isSnoozed("flashcard", "c1")).toBe(false);
  });

  it("1.7 unsnooze de elemento no snoozeado retorna false", () => {
    expect(manager.unsnooze("flashcard", "no-existe")).toBe(false);
  });

  it("1.8 permitir reason opcional", () => {
    const entry = manager.snooze("flashcard", "c1", "Card 1", { reason: "hasta el examen" });
    expect(entry.reason).toBe("hasta el examen");
  });

  it("1.9 source por defecto es 'user'", () => {
    const entry = manager.snooze("flashcard", "c1", "Card 1");
    expect(entry.source).toBe("user");
  });

  it("1.10 source custom", () => {
    const entry = manager.snooze("flashcard", "c1", "Card 1", { source: "system:overload" });
    expect(entry.source).toBe("system:overload");
  });
});

// ── SnoozeManager: tipos múltiples ──

describe("SnoozeManager: múltiples tipos de elementos", () => {
  let manager: SnoozeManager;
  beforeEach(() => {
    manager = new SnoozeManager(new MockPersistence());
  });

  it("2.1 snoozear flashcard", () => {
    manager.snooze("flashcard", "c1", "Card 1");
    expect(manager.isSnoozed("flashcard", "c1")).toBe(true);
  });

  it("2.2 snoozear recording", () => {
    manager.snooze("recording", "r1", "Audio 1");
    expect(manager.isSnoozed("recording", "r1")).toBe(true);
  });

  it("2.3 snoozear note por path", () => {
    manager.snooze("note", "anatomia/corazon.md", "Corazón");
    expect(manager.isSnoozed("note", "anatomia/corazon.md")).toBe(true);
  });

  it("2.4 snoozear pdf", () => {
    manager.snooze("pdf", "p1.pdf", "PDF 1");
    expect(manager.isSnoozed("pdf", "p1.pdf")).toBe(true);
  });

  it("2.5 snoozear topic (afecta a todas las cards del topic)", () => {
    manager.snooze("topic", "farmacologia", "Farmacología");
    // El caller debe filtrar manualmente
    expect(manager.isSnoozed("topic", "farmacologia")).toBe(true);
  });

  it("2.6 snoozear tag", () => {
    manager.snooze("tag", "cardio", "Cardio");
    expect(manager.isSnoozed("tag", "cardio")).toBe(true);
  });

  it("2.7 IDs diferentes no se interfieren", () => {
    manager.snooze("flashcard", "c1", "Card 1");
    manager.snooze("flashcard", "c2", "Card 2");
    expect(manager.isSnoozed("flashcard", "c1")).toBe(true);
    expect(manager.isSnoozed("flashcard", "c2")).toBe(true);
    expect(manager.isSnoozed("flashcard", "c3")).toBe(false);
  });

  it("2.8 tipos diferentes no se interfieren", () => {
    manager.snooze("flashcard", "id1", "Card 1");
    manager.snooze("recording", "id1", "Audio 1"); // mismo id, diferente tipo
    expect(manager.isSnoozed("flashcard", "id1")).toBe(true);
    expect(manager.isSnoozed("recording", "id1")).toBe(true);
  });
});

// ── SnoozeManager: snoozeFor con duraciones humanas ──

describe("SnoozeManager: snoozeFor con duraciones humanas", () => {
  let manager: SnoozeManager;
  beforeEach(() => {
    manager = new SnoozeManager(new MockPersistence());
  });

  it("3.1 '1d' → 1 día", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "1d");
    const entry = manager.getActive("flashcard", "c1")!;
    const remaining = entry.expiresAt! - Date.now();
    expect(remaining).toBeGreaterThan(0.99 * 24 * 3600_000);
    expect(remaining).toBeLessThan(1.01 * 24 * 3600_000);
  });

  it("3.2 '3d' → 3 días", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "3d");
    const entry = manager.getActive("flashcard", "c1")!;
    const remaining = entry.expiresAt! - Date.now();
    expect(remaining).toBeGreaterThan(2.99 * 24 * 3600_000);
  });

  it("3.3 '1w' → 7 días", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "1w");
    const entry = manager.getActive("flashcard", "c1")!;
    const remaining = entry.expiresAt! - Date.now();
    expect(remaining).toBeGreaterThan(6.99 * 24 * 3600_000);
  });

  it("3.4 '1m' → 30 días", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "1m");
    const entry = manager.getActive("flashcard", "c1")!;
    const remaining = entry.expiresAt! - Date.now();
    expect(remaining).toBeGreaterThan(29.9 * 24 * 3600_000);
  });

  it("3.5 'forever' → null (indefinido)", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "forever");
    expect(manager.getActive("flashcard", "c1")!.expiresAt).toBeNull();
  });

  it("3.6 'always' → null", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "always");
    expect(manager.getActive("flashcard", "c1")!.expiresAt).toBeNull();
  });

  it("3.7 'indefinite' → null", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", "indefinite");
    expect(manager.getActive("flashcard", "c1")!.expiresAt).toBeNull();
  });

  it("3.8 duración inválida lanza error", () => {
    expect(() => manager.snoozeFor("flashcard", "c1", "Card 1", "invalid")).toThrow();
  });

  it("3.9 null como duration → indefinido", () => {
    manager.snoozeFor("flashcard", "c1", "Card 1", null);
    expect(manager.getActive("flashcard", "c1")!.expiresAt).toBeNull();
  });
});

// ── snoozeUntil con fecha concreta ──

describe("SnoozeManager: snoozeUntil", () => {
  it("4.1 snoozeUntil con fecha futura", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const future = new Date(Date.now() + 14 * 24 * 3600_000);
    manager.snoozeUntil("flashcard", "c1", "Card 1", future);
    const entry = manager.getActive("flashcard", "c1")!;
    expect(entry.expiresAt).toBe(future.getTime());
  });

  it("4.2 snoozeUntil con fecha pasada lanza error", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const past = new Date(Date.now() - 1000);
    expect(() => manager.snoozeUntil("flashcard", "c1", "Card 1", past)).toThrow();
  });
});

// ── Persistencia ──

describe("SnoozeManager: persistencia", () => {
  it("5.1 carga snoozes desde persistence al crear", () => {
    const persistence = new MockPersistence();
    const oldEntry: SnoozeEntry = {
      id: "old1",
      type: "flashcard",
      targetId: "c1",
      targetName: "Card 1",
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 10000,
      source: "user",
    };
    persistence.save([oldEntry]);
    const manager = new SnoozeManager(persistence);
    expect(manager.isSnoozed("flashcard", "c1")).toBe(true);
  });

  it("5.2 guarda snoozes al crear uno nuevo", () => {
    const persistence = new MockPersistence();
    const manager = new SnoozeManager(persistence);
    manager.snooze("flashcard", "c1", "Card 1");
    const loaded = persistence.load();
    expect(loaded.length).toBe(1);
  });

  it("5.3 persistencia sobrevive a nueva instancia", () => {
    const persistence = new MockPersistence();
    const m1 = new SnoozeManager(persistence);
    m1.snooze("flashcard", "c1", "Card 1");
    const m2 = new SnoozeManager(persistence);
    expect(m2.isSnoozed("flashcard", "c1")).toBe(true);
  });
});

// ── pruneExpired y límites ──

describe("SnoozeManager: prune y límites", () => {
  it("6.1 pruneExpired quita expirados", () => {
    const persistence = new MockPersistence();
    const manager = new SnoozeManager(persistence, { maxEntries: 100 });
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: -1 });
    expect(manager.list().length).toBe(0);
  });

  it("6.2 maxEntries elimina los más antiguos", () => {
    const persistence = new MockPersistence();
    const manager = new SnoozeManager(persistence, { maxEntries: 3 });
    manager.snooze("flashcard", "c1", "Card 1");
    manager.snooze("flashcard", "c2", "Card 2");
    manager.snooze("flashcard", "c3", "Card 3");
    manager.snooze("flashcard", "c4", "Card 4"); // debe eliminar c1
    manager.snooze("flashcard", "c5", "Card 5"); // debe eliminar c2
    const list = manager.list();
    expect(list.length).toBe(3);
    expect(list.some((e) => e.targetId === "c1")).toBe(false);
    expect(list.some((e) => e.targetId === "c2")).toBe(false);
  });

  it("6.3 clear() limpia todo", () => {
    const persistence = new MockPersistence();
    const manager = new SnoozeManager(persistence);
    manager.snooze("flashcard", "c1", "Card 1");
    manager.snooze("flashcard", "c2", "Card 2");
    manager.clear();
    expect(manager.list().length).toBe(0);
  });
});

// ── Stats ──

describe("SnoozeManager: stats", () => {
  it("7.1 stats por tipo", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1");
    manager.snooze("flashcard", "c2", "Card 2");
    manager.snooze("recording", "r1", "Audio 1");
    const stats = manager.stats();
    expect(stats.total).toBe(3);
    expect(stats.byType.flashcard).toBe(2);
    expect(stats.byType.recording).toBe(1);
  });

  it("7.2 count de indefinidos", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: null });
    manager.snooze("flashcard", "c2", "Card 2", { durationMs: 10000 });
    const stats = manager.stats();
    expect(stats.indefinite).toBe(1);
  });

  it("7.3 expiringSoon cuenta lo que expira en 24h", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: 12 * 3600_000 }); // 12h
    manager.snooze("flashcard", "c2", "Card 2", { durationMs: 48 * 3600_000 }); // 48h
    const stats = manager.stats();
    expect(stats.expiringSoon).toBe(1);
  });
});

// ── listExpiringSoon y listIndefinite ──

describe("SnoozeManager: listados", () => {
  it("8.1 listByType filtra por tipo", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1");
    manager.snooze("recording", "r1", "Audio 1");
    expect(manager.listByType("flashcard").length).toBe(1);
    expect(manager.listByType("recording").length).toBe(1);
  });

  it("8.2 listIndefinite solo los null", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: null });
    manager.snooze("flashcard", "c2", "Card 2", { durationMs: 1000 });
    expect(manager.listIndefinite().length).toBe(1);
  });
});

// ── Helpers ──

describe("Helpers de Snooze", () => {
  it("9.1 parseHumanDuration", () => {
    expect(parseHumanDuration("1d")).toBe(24 * 3600_000);
    expect(parseHumanDuration("5h")).toBe(5 * 3600_000);
    expect(parseHumanDuration("1w")).toBe(7 * 24 * 3600_000);
    expect(parseHumanDuration("1m")).toBe(30 * 24 * 3600_000);
    expect(parseHumanDuration("1y")).toBe(365 * 24 * 3600_000);
    expect(parseHumanDuration("2.5d")).toBe(2.5 * 24 * 3600_000);
  });

  it("9.2 parseHumanDuration inválido → null", () => {
    expect(parseHumanDuration("invalid")).toBeNull();
    expect(parseHumanDuration("")).toBeNull();
    expect(parseHumanDuration("1x")).toBeNull();
  });

  it("9.3 formatHumanDuration", () => {
    expect(formatHumanDuration(null)).toBe("indefinido");
    expect(formatHumanDuration(-1)).toBe("expirado");
    expect(formatHumanDuration(5 * 60_000)).toBe("5m");
    expect(formatHumanDuration(3 * 3600_000)).toBe("3h");
    expect(formatHumanDuration(2 * 24 * 3600_000)).toBe("2d");
  });

  it("9.4 formatExpiry", () => {
    expect(formatExpiry(null)).toBe("indefinido");
    expect(formatExpiry(Date.now() - 1000)).toBe("expirado");
    expect(formatExpiry(Date.now() + 5 * 60_000)).toBe("en 5m");
  });
});

// ── Integración con flashcards ──

describe("Snooze: integración con FSRS y Free Review", () => {
  function makeCard(id: string, dueDays: number, stability: number = 0): FlashcardDraft {
    const due = new Date();
    due.setDate(due.getDate() + dueDays);
    return {
      id,
      front: `Q ${id}`,
      back: `A ${id}`,
      fsrs: { stability, difficulty: 5, dueDate: due.toISOString(), reps: 1, lapses: 0 },
    } as FlashcardDraft;
  }

  it("10.1 filterSnoozedFlashcards quita las snoozeadas", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const cards = [makeCard("c1", 0), makeCard("c2", 0), makeCard("c3", 0)];
    manager.snooze("flashcard", "c2", "Card 2");
    const filtered = filterSnoozedFlashcards(manager, cards);
    expect(filtered.length).toBe(2);
    expect(filtered.map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("10.2 getDueCardsExcludingSnoozed solo las due no snoozeadas", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const cards = [
      makeCard("c1", -1), // overdue
      makeCard("c2", 0),  // due hoy
      makeCard("c3", 5),  // due en 5 días
      makeCard("c4", -2), // overdue
    ];
    manager.snooze("flashcard", "c2", "Card 2");
    const due = getDueCardsExcludingSnoozed(manager, cards);
    expect(due.map((c) => c.id).sort()).toEqual(["c1", "c4"]);
  });

  it("10.3 countSnoozedImpact cuenta cuántas se skipean", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const cards = [makeCard("c1", 0), makeCard("c2", 0), makeCard("c3", 0)];
    manager.snooze("flashcard", "c1", "Card 1");
    manager.snooze("flashcard", "c3", "Card 3");
    const stats = countSnoozedImpact(manager, cards);
    expect(stats.total).toBe(3);
    expect(stats.snoozed).toBe(2);
    expect(stats.active).toBe(1);
  });

  it("10.4 cards snoozeadas indefinidamente nunca se incluyen", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const cards = [makeCard("c1", -100), makeCard("c2", -100)];
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: null });
    const due = getDueCardsExcludingSnoozed(manager, cards);
    expect(due.length).toBe(1);
    expect(due[0].id).toBe("c2");
  });

  it("10.5 snooze por topic afecta a todas las cards del topic", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const cards = [
      { ...makeCard("c1", 0), notePath: "anatomia/corazon.md" },
      { ...makeCard("c2", 0), notePath: "fisiologia/sangre.md" },
    ];
    manager.snooze("topic", "anatomia", "Anatomía");
    // Lógica custom: card con notePath que incluye el topic snoozeado
    const filtered = cards.filter((c) => {
      if (manager.isSnoozed("topic", "anatomia") && c.notePath?.includes("anatomia")) return false;
      return !manager.isSnoozed("flashcard", c.id);
    });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("c2");
  });
});

// ── Escenarios reales ──

describe("Snooze: escenarios del día a día", () => {
  it("11.1 'No me muestres esta flashcard hasta el día del examen'", () => {
    const manager = new SnoozeManager(new MockPersistence());
    const examDate = new Date("2026-12-15");
    manager.snoozeUntil("flashcard", "c1", "Anatomía: corazón", examDate, {
      reason: "Repaso del día del examen",
    });
    const entry = manager.getActive("flashcard", "c1")!;
    expect(entry.expiresAt).toBe(examDate.getTime());
  });

  it("11.2 'Esta clase de farmacología no me la repases en 2 semanas'", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snoozeFor("recording", "rec-farma-2026-08-30", "Clase 30 ago", "2w", {
      reason: "Muy pronto, mejor después del parcial",
    });
    expect(manager.isSnoozed("recording", "rec-farma-2026-08-30")).toBe(true);
  });

  it("11.3 'Esta nota es solo de referencia, no me la estudies nunca'", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("note", "referencias/bibliografia.md", "Bibliografía", {
      durationMs: null,
      reason: "Es solo consulta, no estudio",
    });
    expect(manager.isSnoozed("note", "referencias/bibliografia.md")).toBe(true);
  });

  it("11.4 'Pausar todos los PDFs hasta nuevo aviso'", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("pdf", "temario-completo.pdf", "Temario", { durationMs: null });
    manager.snooze("pdf", "guias-esquemas.pdf", "Guías", { durationMs: null });
    expect(manager.listByType("pdf").length).toBe(2);
  });

  it("11.5 'Reanudar tras revisar'", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1");
    expect(manager.isSnoozed("flashcard", "c1")).toBe(true);
    manager.unsnooze("flashcard", "c1");
    expect(manager.isSnoozed("flashcard", "c1")).toBe(false);
  });

  it("11.6 'Snooze expirado se quita automáticamente'", () => {
    const manager = new SnoozeManager(new MockPersistence());
    manager.snooze("flashcard", "c1", "Card 1", { durationMs: -1 });
    expect(manager.isSnoozed("flashcard", "c1")).toBe(false);
  });
});

// ── Config: snooze deshabilitado ──

describe("SnoozeManager: configuración", () => {
  it("12.1 enabled=false bloquea snooze", () => {
    const manager = new SnoozeManager(new MockPersistence(), { enabled: false });
    expect(() => manager.snooze("flashcard", "c1", "Card 1")).toThrow();
  });

  it("12.2 allowIndefinite=false bloquea null", () => {
    const manager = new SnoozeManager(new MockPersistence(), { allowIndefinite: false });
    expect(() => manager.snooze("flashcard", "c1", "Card 1", { durationMs: null })).toThrow();
    // Pero con duración funciona
    expect(() => manager.snooze("flashcard", "c2", "Card 2", { durationMs: 1000 })).not.toThrow();
  });

  it("12.3 defaultDurationMs custom", () => {
    const manager = new SnoozeManager(new MockPersistence(), { defaultDurationMs: 14 * 24 * 3600_000 });
    manager.snooze("flashcard", "c1", "Card 1"); // sin duration
    const entry = manager.getActive("flashcard", "c1")!;
    const remaining = entry.expiresAt! - Date.now();
    expect(remaining).toBeGreaterThan(13.9 * 24 * 3600_000);
  });
});

// ── default config ──

describe("SnoozeManager: DEFAULT_SNOOZE_CONFIG", () => {
  it("13.1 config por defecto", () => {
    expect(DEFAULT_SNOOZE_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SNOOZE_CONFIG.allowIndefinite).toBe(true);
    expect(DEFAULT_SNOOZE_CONFIG.defaultDurationMs).toBe(7 * 24 * 3600_000);
    expect(DEFAULT_SNOOZE_CONFIG.maxEntries).toBe(100);
  });
});
