// dailyJournal.test.ts — v2.26.0 Daily Journal tests.

import { describe, it, expect, beforeEach } from "vitest";
import {
  BUILTIN_TEMPLATES,
  buildDailyNote,
  computeStreak,
  heatmapDays,
  journalDayKey,
  moodHistory,
  instantiateTemplate,
  type DailyTemplate,
  type Mood,
} from "../src/services/dailyJournal.js";

describe("v2.26.0 — dailyJournal · rollover + day key", () => {
  it("journalDayKey devuelve YYYY-MM-DD en UTC", () => {
    const k = journalDayKey(Date.UTC(2026, 8, 21, 12, 0, 0));
    expect(k).toBe("2026-09-21");
  });

  it("rollover a 4 AM: antes de las 4, day key es día anterior", () => {
    // 02:00 = -2h del rollover 04:00 ⇒ día anterior
    const k = journalDayKey(Date.UTC(2026, 8, 22, 2, 0, 0));
    expect(k).toBe("2026-09-21");
  });

  it("rollover: 5 AM = día actual", () => {
    const k = journalDayKey(Date.UTC(2026, 8, 22, 5, 0, 0));
    expect(k).toBe("2026-09-22");
  });
});

describe("v2.26.0 — dailyJournal · templates", () => {
  it("BUILTIN_TEMPLATES tiene al menos uno general + uno por subject", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(1);
    expect(BUILTIN_TEMPLATES.find((t) => t.subject === "*")).toBeTruthy();
    expect(BUILTIN_TEMPLATES.find((t) => t.subject === "anat")).toBeTruthy();
    expect(BUILTIN_TEMPLATES.find((t) => t.subject === "cardio")).toBeTruthy();
  });

  it("instantiateTemplate genera N bloques en orden con texto + meta apropiados", () => {
    const tpl: DailyTemplate = {
      id: "tpl-test",
      subject: "*",
      name: "Test",
      blocks: [
        { kind: "heading", emoji: "📓", title: "Hoy" },
        { kind: "mood" },
        { kind: "gratitude", title: "Agradecido por..." },
        { kind: "callout", emoji: "✨", title: "Reflexión", body: "Una frase" },
        { kind: "divider" },
        { kind: "query-cards-due" },
      ],
    };
    const blocks = instantiateTemplate(tpl, { date: "2026-09-21", subject: "anat" });
    expect(blocks.length).toBe(6);
    expect(blocks[0].meta?.kind).toBe("heading");
    expect(blocks[0].text).toContain("📓");
    expect(blocks[1].meta?.kind).toBe("mood");
    expect(blocks[2].meta?.kind).toBe("gratitude");
    expect(blocks[3].meta?.kind).toBe("callout");
    expect(blocks[4].meta?.kind).toBe("divider");
    expect(blocks[5].meta?.kind).toBe("query-cards-due");
    // The first block has the journalDate baked in.
    expect((blocks[0].meta as any).journalDate).toBe("2026-09-21");
    expect((blocks[0].meta as any).subject).toBe("anat");
  });

  it("buildDailyNote devuelve una Note con isJournal=true y journalDate", () => {
    const note = buildDailyNote({ date: "2026-09-21", subject: "anat" });
    expect(note.isJournal).toBe(true);
    expect(note.journalDate).toBe("2026-09-21");
    expect(note.subject).toBe("anat");
    expect(note.tags).toContain("journal");
    expect(note.tags).toContain("daily");
    expect(note.title).toContain("2026-09-21");
    expect(Array.isArray(note.blocks)).toBe(true);
    expect(note.blocks?.length).toBeGreaterThan(0);
  });
});

describe("v2.26.0 — dailyJournal · streak", () => {
  it("computeStreak con cero journals = current 0", () => {
    const r = computeStreak([], "2026-09-21");
    expect(r.current).toBe(0);
    expect(r.longest).toBe(0);
  });

  it("computeStreak con 1 journal hoy = current 1, longest 1", () => {
    const r = computeStreak(["2026-09-21"], "2026-09-21");
    expect(r.current).toBe(1);
    expect(r.longest).toBe(1);
  });

  it("computeStreak 5 días seguidos = current 5, longest 5", () => {
    const dates = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21"];
    const r = computeStreak(dates, "2026-09-21");
    expect(r.current).toBe(5);
    expect(r.longest).toBe(5);
  });

  it("computeStreak tolera 1 día faltante (grace day)", () => {
    // Falla 09-19 pero hay journals 17,18,20,21 ⇒ con grace recupera los 5
    const dates = ["2026-09-17", "2026-09-18", "2026-09-20", "2026-09-21"];
    const r = computeStreak(dates, "2026-09-21");
    expect(r.current).toBeGreaterThanOrEqual(3);
    expect(r.missed).toBeLessThanOrEqual(1);
  });

  it("computeStreak se rompe tras 2 días faltantes", () => {
    const dates = ["2026-09-15", "2026-09-16"]; // sin escribir 17-21
    const r = computeStreak(dates, "2026-09-21");
    expect(r.current).toBe(0);
  });

  it("computeStreak long-gap: longest preserved aunque current=0", () => {
    const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
    const r = computeStreak(dates, "2026-09-21");
    expect(r.current).toBe(0);
    expect(r.longest).toBe(5);
  });
});

describe("v2.26.0 — dailyJournal · heatmap", () => {
  it("heatmapDays rellena días en el rango con conteo", () => {
    const dates = ["2026-09-15", "2026-09-21"];
    const h = heatmapDays(dates, { start: "2026-09-15", end: "2026-09-21" });
    expect(h["2026-09-15"]).toBe(1);
    expect(h["2026-09-21"]).toBe(1);
    expect(h["2026-09-16"]).toBe(0);
    expect(Object.keys(h).length).toBe(7);
  });

  it("heatmapDays suma múltiples journals en el mismo día", () => {
    const h = heatmapDays(["2026-09-21", "2026-09-21", "2026-09-21"], { start: "2026-09-21", end: "2026-09-21" });
    expect(h["2026-09-21"]).toBe(3);
  });
});

describe("v2.26.0 — dailyJournal · moodHistory", () => {
  it("moodHistory devuelve N entries (1 por día)", () => {
    const r = moodHistory([], 7);
    expect(r.length).toBe(7);
    expect(r[0].date).toBeDefined();
    expect(r[r.length - 1].isToday).toBe(true);
  });

  it("moodHistory extrae el mood del bloque kind=mood", () => {
    const journals = [
      {
        id: "j1", title: "t", body: "", subject: "", tags: [], pages: [], folderId: null,
        createdAt: 0, updatedAt: 0, isJournal: true, journalDate: "2026-09-21",
        blocks: [
          { id: "b0", parentId: null, order: 0, text: "", type: "text", meta: { kind: "mood", mood: { score: 5 as Mood, note: "great" } }, createdAt: 0, updatedAt: 0 },
        ],
      } as any,
    ];
    const r = moodHistory(journals, 7);
    const todayEntry = r.find((e) => e.isToday);
    expect(todayEntry?.mood).toBe(5);
  });

  it("moodHistory devuelve mood=null si no hay journal o sin mood", () => {
    const r = moodHistory([], 30);
    expect(r.every((e) => e.mood === null)).toBe(true);
  });
});
