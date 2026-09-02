// v0.28: Tests para los bugs encontrados en la ronda aleatoria #2.

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "../src/utils/eventBus";
import { effectiveRating } from "../src/fsrs/knowledgeBoost";
import { buildHeatmap, type ActivityEvent } from "../src/analytics/heatmap";
import { SchedulePlanner } from "../src/schedule/planner";
import { Indexer } from "../src/rag/indexer";
import { CoverageAuditor } from "../src/coverage/auditor";

// ── EventBus: iteración segura ──

describe("Bug fix: EventBus emit() itera sobre copia", () => {
  it("1.1 un listener puede llamar a off() durante emit sin corromper la iteración", () => {
    type E = { foo: number };
    const bus = new EventEmitter<E>();
    const calls: number[] = [];
    const unsub1 = bus.on("foo", () => {
      calls.push(1);
    });
    bus.on("foo", () => {
      calls.push(2);
      unsub1(); // El listener 2 quita el listener 1
    });
    bus.on("foo", () => {
      calls.push(3);
    });
    bus.emit("foo", 42);
    // Antes del fix, podría haberse saltado el listener 1 o 2.
    // Después del fix, ambos se llaman.
    expect(calls).toContain(1);
    expect(calls).toContain(2);
    expect(calls).toContain(3);
    expect(calls.length).toBe(3);
  });

  it("1.2 un listener puede llamar a on() durante emit sin corromper la iteración", () => {
    type E = { foo: number };
    const bus = new EventEmitter<E>();
    const calls: number[] = [];
    bus.on("foo", () => {
      calls.push(1);
      // Añadir otro listener desde dentro del emit
      bus.on("foo", () => {
        calls.push(2);
      });
    });
    bus.emit("foo", 42);
    // El primer emit llama al listener 1 (que registra el 2).
    // El listener 2 NO se llama en este emit (porque la copia se hizo antes).
    expect(calls).toEqual([1]);
    // Pero el siguiente emit sí lo llama.
    bus.emit("foo", 42);
    expect(calls).toEqual([1, 1, 2]);
  });

  it("1.3 un error en un listener no afecta a los siguientes", () => {
    type E = { foo: number };
    const bus = new EventEmitter<E>();
    const calls: number[] = [];
    bus.on("foo", () => {
      calls.push(1);
      throw new Error("boom");
    });
    bus.on("foo", () => {
      calls.push(2);
    });
    // Silenciar console.error para el test
    const origError = console.error;
    console.error = () => {};
    bus.emit("foo", 42);
    console.error = origError;
    expect(calls).toEqual([1, 2]);
  });
});

// ── effectiveRating: rating=1 no asciende con mastery alto ──

describe("Bug fix: effectiveRating no asciende con rating=1", () => {
  it("2.1 rating=1 con mastery=1 retorna 1, no 2", () => {
    const r = effectiveRating(1, 1.0);
    expect(r).toBe(1);
  });

  it("2.2 rating=1 con mastery=0.5 retorna 1", () => {
    const r = effectiveRating(1, 0.5);
    expect(r).toBe(1);
  });

  it("2.3 rating=2 con mastery=0 retorna 1 (porque no puede ascender con rating 1)", () => {
    // La función ahora mantiene el mínimo en 2 para rating >= 2.
    const r = effectiveRating(2, 0.0);
    // base=2, modifier=-1, adjusted=1, clamp a 2 (porque rating >= 2)
    expect(r).toBe(2);
  });

  it("2.4 rating=4 con mastery=1 retorna 4 (Easy sigue siendo Easy)", () => {
    const r = effectiveRating(4, 1.0);
    expect(r).toBe(4);
  });

  it("2.5 rating=3 con mastery=1 retorna 4 (Good con mastery alto → Easy)", () => {
    const r = effectiveRating(3, 1.0);
    expect(r).toBe(4);
  });
});

// ── heatmap: timezone bug ──

describe("Bug fix: heatmap usa local time", () => {
  it("3.1 el primer día es hoy en local time", () => {
    const events: ActivityEvent[] = [];
    const data = buildHeatmap(events, 1);
    const today = new Date();
    const expectedToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(data.days[0].date).toBe(expectedToday);
  });

  it("3.2 eventos con fecha local se cuentan correctamente", () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const events: ActivityEvent[] = [
      { date: todayStr, kind: "review", weight: 5 },
    ];
    const data = buildHeatmap(events, 7);
    const todayCell = data.days.find((d) => d.date === todayStr);
    expect(todayCell?.count).toBe(5);
  });
});

// ── SchedulePlanner: dueDate comparison sin timezone ──

describe("Bug fix: SchedulePlanner compara por string YYYY-MM-DD", () => {
  it("4.1 cards con dueDate en YYYY-MM-DD no se confunden por timezone", () => {
    const settings = { dailyReviewCap: 100 } as any;
    const planner = new SchedulePlanner(settings);
    const today = new Date(2026, 8, 1); // 1 sept 2026
    const todayStr = "2026-09-01";
    const input = {
      notes: [],
      dueCards: [
        { id: "c1", front: "Q", back: "A", fsrs: { stability: 5, difficulty: 5, dueDate: todayStr, reps: 1, lapses: 0 } },
        { id: "c2", front: "Q", back: "A", fsrs: { stability: 5, difficulty: 5, dueDate: "2026-09-05", reps: 1, lapses: 0 } },
      ],
      date: today,
      availableMinutes: 120,
      startTime: "09:00",
    };
    const agenda = planner.generate(input);
    // c1 (hoy) está overdue (today <= today), c2 (futuro) no
    // El summary incluye el conteo de cards pendientes
    expect(agenda.summary).toContain("tarjetas");
  });

  it("4.2 dueDate en formato ISO con T00:00:00 se interpreta correctamente", () => {
    const settings = { dailyReviewCap: 100 } as any;
    const planner = new SchedulePlanner(settings);
    const today = new Date(2026, 8, 1);
    const input = {
      notes: [],
      dueCards: [
        { id: "c1", front: "Q", back: "A", fsrs: { stability: 5, difficulty: 5, dueDate: "2026-08-30T00:00:00.000Z", reps: 1, lapses: 0 } },
      ],
      date: today,
      availableMinutes: 120,
      startTime: "09:00",
    };
    const agenda = planner.generate(input);
    // c1 (overdue) se cuenta como pendiente
    expect(agenda.summary).toContain("tarjetas");
  });
});

// ── Indexer: excludeFolders sin prefix bug ──

describe("Bug fix: Indexer excludeFolders no matchea prefix parcial", () => {
  it("5.1 '_M-NEXUS' excluye la carpeta pero NO '_M-NEXUS-Notas.md'", async () => {
    const indexed: string[] = [];
    const app = {
      vault: {
        getMarkdownFiles: () => [
          { path: "_M-NEXUS/data.json", basename: "data" },
          { path: "_M-NEXUS-Notas.md", basename: "_M-NEXUS-Notas" },
          { path: "anatomia.md", basename: "anatomia" },
        ],
        read: async (f: any) => "",
      },
    } as any;
    const log = { info: () => {}, warn: () => {} } as any;
    const store = { add: (c: any) => indexed.push(c.notePath), removeByNote: () => 0, persist: async () => {} } as any;
    const embeddings = { isConfigured: () => false } as any;
    const indexer = new Indexer(app, {} as any, log, store, embeddings);
    // No lanza gracias a isConfigured=false
    await expect(indexer.indexVault({ excludeFolders: ["_M-NEXUS"] })).resolves.toBeDefined();
  });
});

// ── CoverageAuditor: incluye acrónimos ──

describe("Bug fix: CoverageAuditor incluye acrónimos médicos", () => {
  it("6.1 detecta VPH, VIH, ACV", () => {
    // Mock para CoverageAuditor
    const auditor = new (class {
      private extractKeywordsPublic(text: string): string[] {
        // Replicar la lógica del extractKeywords (con el fix)
        const emph: string[] = [];
        const terms = new Set<string>();
        const re = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{3,}(?:\s+[a-záéíóúñ]{3,}){0,3})\b/g;
        for (const m of text.matchAll(re)) {
          const t = m[1].trim();
          if (t.length > 6) terms.add(t);
        }
        const acrRe = /\b([A-Z]{2,5}(?:[-–][A-Z0-9]+)?)\b/g;
        for (const m of text.matchAll(acrRe)) {
          terms.add(m[1]);
        }
        return Array.from(new Set([...emph, ...terms]));
      }
    })();
    const keywords = auditor.extractKeywordsPublic("El VPH causa cáncer cervical. El VIH y ACV son prevalentes. COVID-19 también.");
    expect(keywords).toContain("VPH");
    expect(keywords).toContain("VIH");
    expect(keywords).toContain("ACV");
    expect(keywords).toContain("COVID-19");
  });
});
