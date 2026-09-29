// tasks.ts: REST CRUD para to-do's.
// v1.1.0 — frontend Education Service

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { extractTasks } from "../services/taskExtractor.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface Task {
  id: string;
  text: string;
  done: boolean;
  due: number | null;
  priority: 0 | 1 | 2;
  subject: string;
  createdAt: number;
  updatedAt: number;

  // ── v2.38.0 ────────────────────────────────────────────────────
  // One capture can mean five different things, and the screens that
  // consume them are different. Rather than five stores, one row with a
  // discriminator keeps the offline queue and the sync payload simple.
  //
  // kind defaults to "task" so every row written before this release
  // keeps working untouched.
  kind?: TaskKind;
  /** For `expense`: the amount in cents. */
  amountCents?: number;
  /** For `habit`: daily | weekly | weekdays | custom. */
  cadence?: HabitCadence;
  /** For `habit`: dates on which it was completed, YYYY-MM-DD. */
  streakDays?: string[];
  /** How this row was produced. Absent on rows created before v2.38.0. */
  how?: "rule" | "llm" | "llm+rule" | "manual";
  /** Free-text source the row was extracted from, for "where did this come from". */
  sourceText?: string;
}

/** v2.38.0 — the capture vocabulary. */
export type TaskKind = "task" | "habit" | "shopping" | "expense" | "event";
export type HabitCadence = "daily" | "weekdays" | "weekly" | "custom";

const DATA_FILE = join(process.cwd(), "data", "tasks.json");

/** YYYY-MM-DD in local time, matching the journal's day key. */
function journalDayKey(t: number = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Length of the run of consecutive days ending today or yesterday.
 *
 * Ending *yesterday* still counts: it is a streak the user can extend
 * with today's check-in, and zeroing it at midnight would punish people
 * for opening the app before breakfast.
 */
function currentStreak(days: string[] | undefined): number {
  if (!Array.isArray(days) || days.length === 0) return 0;
  const set = new Set(days);
  const DAY = 86_400_000;
  const now = Date.now();
  let cursor = now;
  if (!set.has(journalDayKey(cursor))) {
    cursor -= DAY;
    if (!set.has(journalDayKey(cursor))) return 0;
  }
  let n = 0;
  while (set.has(journalDayKey(cursor))) {
    n++;
    cursor -= DAY;
  }
  return n;
}

export class TasksService {
  private cache: Task[] | null = null;

  async all(): Promise<Task[]> {
    if (this.cache) return this.cache;
    try {
      const buf = await fs.readFile(DATA_FILE, "utf-8");
      this.cache = JSON.parse(buf);
      return this.cache!;
    } catch {
      this.cache = [];
      await this.save();
      return this.cache;
    }
  }

  async get(id: string): Promise<Task | undefined> {
    return (await this.all()).find((t) => t.id === id);
  }

  async create(input: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task> {
    const list = await this.all();
    const t: Task = { ...input, id: `task-${randomUUID()}`, createdAt: Date.now(), updatedAt: Date.now() };
    list.push(t);
    await this.save();
    return t;
  }
  async update(id: string, patch: Partial<Task>): Promise<Task | null> {
    const list = await this.all();
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((t) => t.id !== id);
    if (next.length === list.length) return false;
    this.cache = next;
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}

const svc = new TasksService();
export const tasksServiceInstance = svc;

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  // v2.6.0: demo data is opt-in via /admin/demo/load.

  app.get("/tasks", async () => {
    const list = await svc.all();
    return { tasks: list, total: list.length };
  });

  app.get<{ Params: { id: string } }>("/tasks/:id", async (req) => {
    const t = await svc.get(req.params.id);
    if (!t) throw E.val("EC-TSK-001", "Task no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return t;
  });

  app.post<{ Body: Partial<Task> }>("/tasks", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.text) throw E.val("EC-TSK-002", "text requerido", { context: { body: b } });
    const t = await svc.create({
      text: b.text,
      done: b.done ?? false,
      due: b.due ?? null,
      priority: (b.priority ?? 0) as 0 | 1 | 2,
      subject: b.subject ?? "",
      // v2.38.0 — absent stays absent so legacy rows round-trip byte-identical.
      ...(b.kind ? { kind: b.kind } : {}),
      ...(typeof b.amountCents === "number" ? { amountCents: b.amountCents } : {}),
      ...(b.cadence ? { cadence: b.cadence } : {}),
      ...(Array.isArray(b.streakDays) ? { streakDays: b.streakDays } : {}),
      ...(b.how ? { how: b.how } : {}),
      ...(b.sourceText ? { sourceText: b.sourceText } : {}),
    });
    reply.code(201);
    logOp("tasks", "created", true, { id: t.id });
    return t;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Task> }>("/tasks/:id", async (req) => {
    const t = await svc.update(req.params.id, req.body ?? {});
    if (!t) throw E.val("EC-TSK-003", "Task no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return t;
  });

  app.delete<{ Params: { id: string } }>("/tasks/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-TSK-004", "Task no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });

  /// v1.1.0: toggle done en un endpoint dedicado
  // ── v2.38.0: capture ─────────────────────────────────────────
  // POST /api/v1/tasks/capture
  //
  //   { text, useLlm?, persist? }
  //
  // Parses free text into tasks and, unless `persist: false`, stores
  // them. The response always includes the parse, so a client can show
  // a preview and let the user edit before anything is written.
  app.post<{
    Body: { text?: string; useLlm?: boolean; persist?: boolean; sourceText?: string };
  }>("/tasks/capture", async (req, reply) => {
    const b = req.body ?? {};
    const text = String(b.text ?? "").trim();
    if (!text) throw E.val("EC-TSK-010", "text requerido", { statusCode: 400 });

    const t0 = Date.now();
    const result = await extractTasks(text, { useLlm: b.useLlm === true });

    if (b.persist === false) {
      return { ...result, created: [] };
    }

    const created: Task[] = [];
    for (const x of result.tasks) {
      created.push(
        await svc.create({
          text: x.text,
          done: false,
          due: x.due,
          priority: x.priority,
          subject: x.subject,
          kind: x.kind,
          ...(x.amountCents !== undefined ? { amountCents: x.amountCents } : {}),
          ...(x.cadence ? { cadence: "daily" as HabitCadence } : {}),
          how: x.how,
          sourceText: b.sourceText ?? text,
        }),
      );
    }
    logOp("tasks", "captured", true, {
      n: created.length, llm: result.usedLlm, ms: Date.now() - t0,
    });
    reply.code(201);
    return { ...result, created };
  });

  // POST /api/v1/tasks/:id/habit-check
  // Marks today done for a habit and returns the recomputed streak.
  app.post<{ Params: { id: string } }>("/tasks/:id/habit-check", async (req) => {
    const t = await svc.get(req.params.id);
    if (!t) throw E.val("EC-TSK-011", "Hábito no encontrado", { statusCode: 404 });
    if (t.kind !== "habit") {
      throw E.val("EC-TSK-012", "La tarea no es un hábito", {
        context: { kind: t.kind ?? "task" }, statusCode: 400,
      });
    }
    const day = journalDayKey();
    const days = Array.isArray(t.streakDays) ? [...t.streakDays] : [];
    if (!days.includes(day)) days.push(day);
    days.sort();
    // Keep a year of history; a streak longer than that is not a streak.
    const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const kept = days.filter((d) => d >= cutoff);
    const updated = await svc.update(req.params.id, { streakDays: kept, done: true });
    return { task: updated, streak: currentStreak(kept) };
  });

  // GET /api/v1/tasks/summary?kind=shopping
  // Aggregates the capture vocabulary into what each screen needs.
  app.get<{ Querystring: { kind?: string } }>("/tasks/summary", async (req) => {
    const all = await svc.all();
    const kind = req.query?.kind as TaskKind | undefined;
    const mine = kind ? all.filter((t) => (t.kind ?? "task") === kind) : all;
    if (kind === "expense") {
      const spent = mine.reduce((n, t) => n + (t.amountCents ?? 0), 0);
      return {
        kind,
        count: mine.length,
        totalCents: spent,
        entries: mine.sort((a, b) => (b.due ?? b.createdAt) - (a.due ?? a.createdAt)),
      };
    }
    if (kind === "habit") {
      return {
        kind,
        count: mine.length,
        active: mine.filter((t) => currentStreak(t.streakDays) > 0).length,
        entries: mine.map((t) => ({ ...t, streak: currentStreak(t.streakDays) })),
      };
    }
    return {
      kind: kind ?? "task",
      count: mine.length,
      pending: mine.filter((t) => !t.done).length,
      entries: mine.filter((t) => !t.done),
    };
  });

  app.post<{ Params: { id: string } }>("/tasks/:id/toggle", async (req) => {
    const t = await svc.get(req.params.id);
    if (!t) throw E.val("EC-TSK-005", "Task no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    const updated = await svc.update(req.params.id, { done: !t.done });
    return updated;
  });
}

async function ensureSeeded(svc: TasksService) {
  const list = await svc.all();
  if (list.length > 0) return;
  const inDays = (n: number, h = 23, m = 59) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const seed: Array<Omit<Task, "id" | "createdAt" | "updatedAt">> = [
    { text: "Submit politics-econ essay", done: false, due: inDays(1), priority: 2, subject: "pol" },
    { text: "Read chapter 7 — Biology", done: false, due: inDays(2, 18), priority: 1, subject: "bio" },
    { text: "Practice integrals (set 3)", done: false, due: inDays(0, 22), priority: 0, subject: "math" },
    { text: "Chemistry lab report", done: false, due: inDays(4), priority: 1, subject: "che" },
    { text: "Buy lab coat", done: true, due: null, priority: 0, subject: "che" },
    { text: "Email professor about Referat", done: true, due: null, priority: 0, subject: "deu" },
  ];
  for (const s of seed) await svc.create(s);
}
