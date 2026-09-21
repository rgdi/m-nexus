/* ============================================================
 * services/dailyJournal.ts — Daily Notes service (Notion-grade).
 *
 * v2.26.0 — premium daily journal experience.
 *
 * Features:
 *   1. Auto-create a DailyNote per (date, subject, userId)
 *      with rich, template-populated blocks (Notion-style).
 *   2. Auto-rollover at 04:00 local — the "day" boundary is
 *      configurable so night-shift students aren't punished.
 *   3. Daily-streak calculation with grace day (1 missed allowed).
 *   4. Live embeddable blocks (queries) so the daily note
 *      auto-pulls "cards due today", "events now", etc.
 *   5. Mood field per daily (1-5 scale, emoji); mood history
 *      aggregated for 7- and 30-day trend.
 *   6. Per-subject templates (default "general", overridable
 *      e.g. "anatomy" gets an extra "Casos clínicos" section).
 *   7. Calendar heatmap (7d / 30d / 365d density).
 *
 * Persistence: same `notes.json` (Note interface already has
 * isJournal + journalDate fields).
 * ============================================================ */

import { randomUUID } from "node:crypto";
import type { Note } from "../routes/notes.js";

/** A journal "day" rollover hour. 04:00 = midnight for late-night students. */
export const ROLLOVER_HOUR = 4;

export type JournalBlockKind =
  | "heading"
  | "subheading"
  | "divider"
  | "callout"
  | "todo"
  | "mood"
  | "gratitude"
  | "learnings"
  | "questions"
  | "agenda"
  | "query-cards-due"
  | "query-events-today"
  | "query-tasks-open"
  | "query-recent-notes"
  | "embed-spaced"
  | "embed-stats"
  | "free";

export interface JournalTemplateBlock {
  kind: JournalBlockKind;
  title?: string;
  body?: string;
  emoji?: string;
  config?: Record<string, unknown>;
}

export interface DailyTemplate {
  id: string;
  subject: string;            // matches Note.subject; "*" = default
  name: string;
  blocks: JournalTemplateBlock[];
}

/* ============================================================
 * Built-in templates (extendable per user via /api/v1/journal/templates)
 * ============================================================ */

export const BUILTIN_TEMPLATES: DailyTemplate[] = [
  {
    id: "tpl-general",
    subject: "*",
    name: "General",
    blocks: [
      { kind: "heading", emoji: "📓", title: "Hoy" },
      { kind: "mood" },
      { kind: "gratitude", title: "3 cosas por las que estoy agradecido/a" },
      { kind: "agenda", title: "Agenda del día" },
      { kind: "query-events-today" },
      { kind: "query-cards-due", title: "Tarjetas para repasar" },
      { kind: "query-tasks-open", title: "Tareas abiertas" },
      { kind: "divider" },
      { kind: "learnings", title: "Lo que aprendí hoy" },
      { kind: "questions", title: "Lo que todavía no entiendo" },
      { kind: "divider" },
      { kind: "callout", emoji: "✨", title: "Reflexión del día",
        body: "Una frase: ¿qué te llevas de hoy?" },
      { kind: "free" },
    ],
  },
  {
    id: "tpl-medicina",
    subject: "anat",
    name: "Anatomía",
    blocks: [
      { kind: "heading", emoji: "🫀", title: "Anatomía · Hoy" },
      { kind: "mood" },
      { kind: "agenda", title: "Prácticas / seminarios" },
      { kind: "query-events-today" },
      { kind: "query-cards-due", title: "Repaso anatomía" },
      { kind: "divider" },
      { kind: "learnings", title: "Estructuras, inserciones, relaciones" },
      { kind: "questions", title: "Dudas para seminario" },
      { kind: "free" },
    ],
  },
  {
    id: "tpl-cardio",
    subject: "cardio",
    name: "Cardiología",
    blocks: [
      { kind: "heading", emoji: "❤️", title: "Cardiología · Hoy" },
      { kind: "mood" },
      { kind: "agenda", title: "Casos clínicos" },
      { kind: "query-events-today" },
      { kind: "query-cards-due", title: "Repaso FSRS-6" },
      { kind: "divider" },
      { kind: "learnings", title: "Fisiopatología cardiovascular" },
      { kind: "free" },
    ],
  },
];

export const DEFAULT_TEMPLATE_ID = "tpl-general";

/* ============================================================
 * Day key (yyyy-mm-dd with rollover)
 * ============================================================ */

export function journalDayKey(ts: number = Date.now()): string {
  // Roll date forward if hour < ROLLOVER_HOUR (treat as previous day)
  const d = new Date(ts - ROLLOVER_HOUR * 3600_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isJournalFor(note: Note, dayKey: string = journalDayKey()): boolean {
  return Boolean(note?.isJournal && note?.journalDate === dayKey);
}

/* ============================================================
 * Mood field
 * ============================================================ */

export type Mood = 1 | 2 | 3 | 4 | 5;

export const MOOD_EMOJI: Record<Mood, string> = {
  1: "😞",
  2: "😕",
  3: "😐",
  4: "🙂",
  5: "🤩",
};

export const MOOD_LABEL: Record<Mood, string> = {
  1: "Mal",
  2: "Bajo",
  3: "Normal",
  4: "Bien",
  5: "Excelente",
};

/* ============================================================
 * Template instantiation → real Block[]
 * ============================================================ */

export function instantiateTemplate(
  template: DailyTemplate,
  ctx: { date: string; subject: string; userId?: string },
): import("./blocks.js").Block[] {
  const blocks: import("./blocks.js").Block[] = [];
  const now = Date.now();

  for (const t of template.blocks) {
    const id = `block-${randomUUID()}`;
    let text = "";
    let type: import("./blocks.js").BlockType = "text";
    let meta: Record<string, unknown> = { kind: t.kind, title: t.title, emoji: t.emoji };

    switch (t.kind) {
      case "heading":
      case "subheading":
        text = `${t.emoji ? t.emoji + " " : ""}${t.title ?? ""}`;
        type = t.kind === "subheading" ? "callout" : "text";
        meta = { ...meta, headingLevel: t.kind === "heading" ? 1 : 2 };
        break;
      case "divider":
        text = "---";
        type = "text";
        meta = { ...meta, divider: true };
        break;
      case "callout":
        text = t.body ?? t.title ?? "";
        type = "callout";
        meta = { ...meta, calloutTitle: t.title };
        break;
      case "todo":
        text = t.body ?? "";
        type = "text";
        meta = { ...meta, todo: true, done: false };
        break;
      case "mood":
        text = "¿Cómo me siento hoy?";
        type = "text";
        meta = { ...meta, mood: { score: null, note: "" } };
        break;
      case "gratitude":
        text = "1. \n2. \n3. ";
        type = "text";
        meta = { ...meta, gratitude: true };
        break;
      case "learnings":
        text = "";
        type = "text";
        meta = { ...meta, learnings: true };
        break;
      case "questions":
        text = "";
        type = "text";
        meta = { ...meta, questions: true };
        break;
      case "agenda":
        text = "";
        type = "text";
        meta = { ...meta, agenda: true };
        break;
      case "query-cards-due":
        text = "🃏 Cargando tarjetas…";
        type = "cloze";
        meta = { ...meta, query: { type: "cards-due", refreshOnView: true } };
        break;
      case "query-events-today":
        text = "📅 Cargando eventos…";
        type = "text";
        meta = { ...meta, query: { type: "events-today", refreshOnView: true } };
        break;
      case "query-tasks-open":
        text = "✓ Cargando tareas…";
        type = "text";
        meta = { ...meta, query: { type: "tasks-open" } };
        break;
      case "query-recent-notes":
        text = "📝 Notas recientes…";
        type = "text";
        meta = { ...meta, query: { type: "recent-notes", limit: 5 } };
        break;
      case "embed-spaced":
        text = "📚 Cola FSRS-6";
        type = "cloze";
        meta = { ...meta, embed: { type: "spaced-queue", order: "due" } };
        break;
      case "embed-stats":
        text = "📊 Estadísticas del estudio";
        type = "callout";
        meta = { ...meta, embed: { type: "study-stats", windowDays: 7 } };
        break;
      case "free":
      default:
        text = "";
        type = "text";
        meta = { ...meta, free: true };
        break;
    }

    blocks.push({
      id,
      parentId: null,
      order: blocks.length,
      text,
      type,
      meta,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Bake date/subject/userId into the first heading meta for traceability.
  blocks[0] && (blocks[0].meta = { ...(blocks[0].meta ?? {}), journalDate: ctx.date, subject: ctx.subject, userId: ctx.userId ?? null });
  return blocks;
}

/* ============================================================
 * Daily note operations (consumers: routes/journal.ts)
 * ============================================================ */

export function buildDailyNote(
  ctx: { date: string; subject: string; userId?: string },
  template: DailyTemplate = BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!,
): Note {
  const blocks = instantiateTemplate(template, ctx);
  return {
    id: `journal-${ctx.date}-${ctx.subject || "general"}`,
    title: `📓 ${ctx.date}${ctx.subject ? " · " + ctx.subject : ""}`,
    body: "",
    subject: ctx.subject || "",
    tags: ["journal", "daily"],
    pages: [{ strokes: [], placeholders: [] }],
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    blocks,
    isJournal: true,
    journalDate: ctx.date,
  };
}

/**
 * Compute streak (consecutive days) ending at `today`.
 * Allows 1 grace day (missed day recovers the streak).
 */
export function computeStreak(
  journalDates: string[],
  today: string = journalDayKey(),
): { current: number; longest: number; missed: number } {
  const set = new Set(journalDates);
  const sorted = journalDates.filter(Boolean).slice().sort(); // asc

  // Longest streak in history
  let longest = 0, cur = 0, prev: string | null = null;
  for (const d of sorted) {
    if (prev === null) cur = 1;
    else {
      const pd = new Date(prev + "T12:00:00Z").getTime();
      const dd = new Date(d + "T12:00:00Z").getTime();
      const diff = (dd - pd) / (24 * 3600_000);
      if (diff === 1) cur++;
      else if (diff === 0) continue; // duplicate
      else cur = 1;
    }
    if (cur > longest) longest = cur;
    prev = d;
  }

  // Current streak (walking back from today, allowing 1 grace)
  let current = 0;
  let missed = 0;
  let cursor = today;
  while (true) {
    if (set.has(cursor)) {
      current++;
    } else if (missed < 1) {
      missed++;
    } else {
      break;
    }
    const t = new Date(cursor + "T12:00:00Z").getTime() - 24 * 3600_000;
    cursor = journalDayKey(t);
    if (cursor < "2000-01-01") break;
  }
  return { current, longest, missed: current > 0 ? missed : 0 };
}

/* ============================================================
 * Heatmap density for a calendar grid
 * ============================================================ */

export function heatmapDays(
  journalDates: string[],
  range: { start: string; end: string },
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const d of journalDates) counts.set(d, (counts.get(d) ?? 0) + 1);
  const out: Record<string, number> = {};
  const start = new Date(range.start + "T12:00:00Z").getTime();
  const end = new Date(range.end + "T12:00:00Z").getTime();
  for (let t = start; t <= end; t += 24 * 3600_000) {
    const k = journalDayKey(t + 12 * 3600_000); // neutral mid-day
    out[k] = counts.get(k) ?? 0;
  }
  return out;
}

/* ============================================================
 * Mood history (last N days) — read mood from each journal's first mood block.
 * ============================================================ */

export function moodHistory(
  journals: Note[],
  days = 30,
): Array<{ date: string; mood: Mood | null; isToday: boolean }> {
  const byDate = new Map<string, Note>();
  for (const j of journals) {
    if (j.isJournal && j.journalDate) byDate.set(j.journalDate, j);
  }
  const out: Array<{ date: string; mood: Mood | null; isToday: boolean }> = [];
  const today = journalDayKey();
  for (let i = days - 1; i >= 0; i--) {
    const t = Date.now() - i * 24 * 3600_000;
    const d = journalDayKey(t);
    const j = byDate.get(d);
    let mood: Mood | null = null;
    if (j) {
      const moodBlock = (j.blocks ?? []).find((b) => b?.meta?.kind === "mood");
      const score = (moodBlock?.meta as any)?.mood?.score;
      if (typeof score === "number") mood = score as Mood;
    }
    out.push({ date: d, mood, isToday: d === today });
  }
  return out;
}
