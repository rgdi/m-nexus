// routes/journal.ts — premium daily journal REST API.
//
// v2.26.0 — Notion-grade daily journaling.

import { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import type { Note } from "./notes.js";
import { NoteBlocks } from "../services/blocks.js";
import {
  BUILTIN_TEMPLATES,
  buildDailyNote,
  computeStreak,
  heatmapDays,
  journalDayKey,
  moodHistory,
  type JournalTemplateBlock,
  type DailyTemplate,
  type Mood,
} from "../services/dailyJournal.js";

const NOTES_FILE = join(process.cwd(), "data", "notes.json");
const TEMPLATES_FILE = join(process.cwd(), "data", "journal-templates.json");

class NotesGateway {
  private cache: Note[] | null = null;
  private mtime: number | null = null;

  private async load(): Promise<Note[]> {
    try {
      const stat = await fs.stat(NOTES_FILE);
      if (this.cache && this.mtime === stat.mtimeMs) return this.cache;
      const buf = await fs.readFile(NOTES_FILE, "utf-8");
      this.cache = JSON.parse(buf);
      this.mtime = stat.mtimeMs;
      return this.cache!;
    } catch {
      this.cache = [];
      this.mtime = null;
      await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
      await fs.writeFile(NOTES_FILE, "[]");
      return this.cache;
    }
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.writeFile(NOTES_FILE, JSON.stringify(this.cache, null, 2));
    try {
      const stat = await fs.stat(NOTES_FILE);
      this.mtime = stat.mtimeMs;
    } catch {}
  }

  async all(): Promise<Note[]> { return this.load(); }

  async findJournal(date: string, subject: string): Promise<Note | null> {
    const list = await this.all();
    return list.find((n) => n.isJournal && n.journalDate === date && (n.subject || "") === (subject || "")) ?? null;
  }

  async ensureJournal(date: string, subject: string, templateId?: string): Promise<Note> {
    const existing = await this.findJournal(date, subject);
    if (existing) return existing;
    const tpl = (await loadTemplates()).find((t) => t.id === templateId) ?? BUILTIN_TEMPLATES.find((t) => t.subject === subject) ?? BUILTIN_TEMPLATES[0];
    const note = buildDailyNote({ date, subject });
    const list = await this.all();
    list.push(note);
    await this.save();
    logOp("journal", "ensure", true, { date, subject });
    return note;
  }

  async listJournals(): Promise<Note[]> {
    const list = await this.all();
    return list.filter((n) => n.isJournal && n.journalDate);
  }

  async patchJournal(id: string, patch: Partial<Note> & { addBlock?: { kind: string; text?: string; type?: string } }): Promise<Note | null> {
    const list = await this.all();
    const i = list.findIndex((n) => n.id === id && n.isJournal);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id: list[i].id, updatedAt: Date.now() };
    if (patch.addBlock) {
      NoteBlocks.append(list[i], {
        text: patch.addBlock.text || "",
        type: (patch.addBlock.type as any) || "text",
      });
    }
    await this.save();
    return list[i];
  }

  async setMood(id: string, score: Mood, note: string): Promise<Note | null> {
    const list = await this.all();
    const i = list.findIndex((n) => n.id === id && n.isJournal);
    if (i < 0) return null;
    const journal = list[i];
    const blocks = NoteBlocks.ensure(journal);
    const moodBlock = blocks.find((b) => b?.meta?.kind === "mood");
    if (!moodBlock) return null;
    const meta = { ...(moodBlock.meta || {}), mood: { score, note } };
    moodBlock.meta = meta;
    moodBlock.updatedAt = Date.now();
    // Serialize meta back into text for journal body fallback.
    moodBlock.text = `${note || ""}`.trim();
    journal.updatedAt = Date.now();
    await this.save();
    return journal;
  }

  async patchBlockInJournal(journalId: string, blockId: string, patch: { text?: string; type?: string; meta?: any }): Promise<any> {
    const list = await this.all();
    const journal = list.find((n) => n.id === journalId && n.isJournal);
    if (!journal) return null;
    const updated = NoteBlocks.patch(journal, blockId, patch as any);
    if (!updated) return null;
    journal.updatedAt = Date.now();
    await this.save();
    return updated;
  }
}

class TemplatesGateway {
  private cache: DailyTemplate[] | null = null;

  async all(): Promise<DailyTemplate[]> {
    if (this.cache) return this.cache;
    try {
      const buf = await fs.readFile(TEMPLATES_FILE, "utf-8");
      this.cache = JSON.parse(buf);
    } catch {
      this.cache = [];
      await this.save();
    }
    return this.cache!;
  }

  async save(): Promise<void> {
    await fs.writeFile(TEMPLATES_FILE, JSON.stringify(this.cache, null, 2));
  }

  async upsert(tpl: DailyTemplate): Promise<DailyTemplate> {
    const list = await this.all();
    const i = list.findIndex((t) => t.id === tpl.id);
    if (i >= 0) list[i] = tpl;
    else list.push(tpl);
    await this.save();
    return tpl;
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const before = list.length;
    this.cache = list.filter((t) => t.id !== id);
    if (this.cache!.length === before) return false;
    await this.save();
    return true;
  }
}

const notesGw = new NotesGateway();
const templatesGw = new TemplatesGateway();
async function loadTemplates() {
  const user = await templatesGw.all();
  return [...BUILTIN_TEMPLATES, ...user];
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  // ---- meta ----
  app.get("/journal/meta", async () => ({
    today: journalDayKey(),
    rolloverHour: 4,
    builtinTemplates: BUILTIN_TEMPLATES.map((t) => ({ id: t.id, subject: t.subject, name: t.name, blockCount: t.blocks.length })),
  }));

  // ---- today auto-create-or-fetch ----
  // Idempotent. Returns the current day journal (creates on first call per day).
  app.post<{ Body: { subject?: string; templateId?: string; date?: string } }>(
    "/journal/today",
    async (req) => {
      const date = req.body?.date || journalDayKey();
      const subject = req.body?.subject || "";
      const tplId = req.body?.templateId;
      const note = await notesGw.ensureJournal(date, subject, tplId);
      return note;
    },
  );

  // ---- fetch by id ----
  app.get<{ Params: { id: string } }>("/journal/:id", async (req, reply) => {
    const list = await notesGw.all();
    const note = list.find((n) => n.id === req.params.id);
    if (!note || !note.isJournal) {
      return reply.code(404).send({ error: "Not a journal" });
    }
    return note;
  });

  // ---- patch journal ----
  app.patch<{ Params: { id: string }; Body: Partial<Note> & { addBlock?: { kind: string; text?: string; type?: string } } }>(
    "/journal/:id",
    async (req, reply) => {
      const updated = await notesGw.patchJournal(req.params.id, req.body ?? {});
      if (!updated) return reply.code(404).send({ error: "Not found" });
      return updated;
    },
  );

  // ---- patch block inside a journal ----
  app.patch<{ Params: { id: string; blockId: string }; Body: { text?: string; type?: string; meta?: any } }>(
    "/journal/:id/blocks/:blockId",
    async (req, reply) => {
      const updated = await notesGw.patchBlockInJournal(req.params.id, req.params.blockId, req.body ?? {});
      if (!updated) return reply.code(404).send({ error: "Block not found" });
      return updated;
    },
  );

  // ---- set mood ----
  app.post<{ Params: { id: string }; Body: { score: Mood; note?: string } }>(
    "/journal/:id/mood",
    async (req, reply) => {
      const score = req.body?.score;
      if (!score || score < 1 || score > 5) {
        return reply.code(400).send({ error: "score must be 1..5" });
      }
      const note = req.body?.note || "";
      const updated = await notesGw.setMood(req.params.id, score, note);
      if (!updated) return reply.code(404).send({ error: "Not a journal" });
      return { ok: true, mood: { score, note }, journal: { id: updated.id, date: updated.journalDate } };
    },
  );

  // ---- list journals (paginated by month/year) ----
  app.get<{ Querystring: { from?: string; to?: string; subject?: string; limit?: string } }>(
    "/journal/list",
    async (req) => {
      const list = await notesGw.listJournals();
      const subject = req.query?.subject;
      const from = req.query?.from;
      const to = req.query?.to;
      const filtered = list.filter((n) => {
        if (subject !== undefined && (n.subject || "") !== subject) return false;
        if (from && (n.journalDate ?? "") < from) return false;
        if (to && (n.journalDate ?? "") > to) return false;
        return true;
      });
      const limit = Math.min(parseInt(req.query?.limit || "365", 10) || 365, 365);
      const sorted = filtered
        .sort((a, b) => (b.journalDate ?? "").localeCompare(a.journalDate ?? ""))
        .slice(0, limit);
      return { journals: sorted, total: sorted.length, totalAll: list.length };
    },
  );

  // ---- streak ----
  app.get("/journal/streak", async () => {
    const list = await notesGw.listJournals();
    const dates = list.map((n) => n.journalDate!).filter(Boolean);
    return computeStreak(dates);
  });

  // ---- heatmap ----
  app.get<{ Querystring: { from?: string; to?: string } }>("/journal/heatmap", async (req) => {
    const today = journalDayKey();
    const days = req.query?.from && req.query?.to ? 365 : 30;
    const endDate = req.query?.to || today;
    const startMs = new Date(endDate + "T12:00:00Z").getTime() - (days - 1) * 24 * 3600_000;
    const startDate = req.query?.from || journalDayKey(startMs);
    const list = await notesGw.listJournals();
    const dates = list.map((n) => n.journalDate!).filter(Boolean);
    return { start: startDate, end: endDate, density: heatmapDays(dates, { start: startDate, end: endDate }) };
  });

  // ---- mood history (last N days) ----
  app.get<{ Querystring: { days?: string } }>("/journal/mood-history", async (req) => {
    const days = Math.min(parseInt(req.query?.days || "30", 10) || 30, 365);
    const list = await notesGw.listJournals();
    return { days, entries: moodHistory(list, days) };
  });

  // ---- templates CRUD ----
  app.get("/journal/templates", async () => {
    const all = await loadTemplates();
    return { templates: all };
  });

  app.post<{ Body: DailyTemplate }>("/journal/templates", async (req) => {
    const tpl = req.body;
    if (!tpl.id) tpl.id = `tpl-${randomUUID().slice(0, 8)}`;
    return templatesGw.upsert(tpl);
  });

  app.delete<{ Params: { id: string } }>("/journal/templates/:id", async (req, reply) => {
    if (req.params.id.startsWith("tpl-")) {
      // built-in or seeded identifier; only user templates can be deleted
    }
    const ok = await templatesGw.remove(req.params.id);
    if (!ok) return reply.code(404).send({ error: "Template not found" });
    return { ok: true };
  });

  // ---- live embed resolver (used by the frontend on demand) ----
  app.post<{ Body: { type: string; payload?: any } }>("/journal/embed/resolve", async (req) => {
    const t = req.body?.type;
    if (t === "cards-due") return { type: t, items: await resolveCardsDue() };
    if (t === "events-today") return { type: t, items: await resolveEventsToday() };
    if (t === "tasks-open") return { type: t, items: await resolveTasksOpen() };
    if (t === "recent-notes") return { type: t, items: await resolveRecentNotes(req.body?.payload?.limit || 5) };
    if (t === "spaced-queue") return { type: t, items: await resolveCardsDue() };
    if (t === "study-stats") return { type: t, items: await resolveStudyStats(req.body?.payload?.windowDays || 7) };
    return { type: t, items: [] };
  });
}

/* ============================================================
 * Embed resolvers — read from sibling services via JSON files
 * (kept simple to avoid cross-coupling; production would inject
 * the services in the server bootstrap).
 * ============================================================ */

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const buf = await fs.readFile(path, "utf-8");
    return JSON.parse(buf) as T;
  } catch {
    return fallback;
  }
}

async function resolveCardsDue(): Promise<any[]> {
  const cards = await readJson<any[]>(join(process.cwd(), "data", "flashcards.json"), []);
  const now = Date.now();
  return cards
    .filter((c) => {
      const fs = c.fsrs || {};
      const due = fs.due ?? 0;
      const state = fs.state ?? "new";
      return state === "review" || state === "learning" || state === "relearning" || due <= now;
    })
    .slice(0, 10)
    .map((c) => ({ id: c.id, front: c.front?.slice(0, 60), subject: c.subject, due: c.fsrs?.due }));
}

async function resolveEventsToday(): Promise<any[]> {
  const events = await readJson<any[]>(join(process.cwd(), "data", "events.json"), []);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return events
    .filter((e) => (e.start ?? 0) >= start.getTime() && (e.start ?? 0) <= end.getTime())
    .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, subject: e.subject }));
}

async function resolveTasksOpen(): Promise<any[]> {
  const tasks = await readJson<any[]>(join(process.cwd(), "data", "tasks.json"), []);
  return tasks.filter((t) => !t.done).slice(0, 20);
}

async function resolveRecentNotes(limit: number): Promise<any[]> {
  const notes = await readJson<any[]>(NOTES_FILE, []);
  return notes
    .filter((n) => !n.isJournal)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit)
    .map((n) => ({ id: n.id, title: n.title, subject: n.subject, updatedAt: n.updatedAt }));
}

async function resolveStudyStats(windowDays: number): Promise<any> {
  const list = await readJson<any[]>(NOTES_FILE, []);
  const journals = list.filter((n) => n.isJournal && n.journalDate);
  const recent = journals.filter((n) => Date.now() - new Date(n.journalDate + "T12:00:00Z").getTime() < windowDays * 24 * 3600_000);
  const cards = await readJson<any[]>(join(process.cwd(), "data", "flashcards.json"), []);
  const studied = cards.filter((c) => (c.fsrs?.reps ?? 0) > 0);
  return {
    windowDays,
    journalCount: recent.length,
    cardsStudied: studied.length,
    avgDaily: recent.length > 0 ? Math.round(studied.length / recent.length) : 0,
  };
}
