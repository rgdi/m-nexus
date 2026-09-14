// events.ts: REST CRUD para eventos del calendar.
// v1.1.0 — frontend Education Service

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface CalendarEvent {
  id: string;
  title: string;
  prof: string;
  room: string;
  type: string; // Homework, Referat, Lecture, Exam, etc.
  subject: string;
  start: number;
  end: number;
  createdAt: number;
  updatedAt: number;
}

const DATA_FILE = join(process.cwd(), "data", "events.json");

class EventsService {
  private cache: CalendarEvent[] | null = null;

  async all(): Promise<CalendarEvent[]> {
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

  async listBetween(from: number, to: number): Promise<CalendarEvent[]> {
    return (await this.all()).filter((e) => e.start >= from && e.start < to);
  }

  async get(id: string): Promise<CalendarEvent | undefined> {
    return (await this.all()).find((e) => e.id === id);
  }

  async create(input: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">): Promise<CalendarEvent> {
    const list = await this.all();
    const e: CalendarEvent = { ...input, id: `evt-${randomUUID()}`, createdAt: Date.now(), updatedAt: Date.now() };
    list.push(e);
    await this.save();
    return e;
  }

  async update(id: string, patch: Partial<CalendarEvent>): Promise<CalendarEvent | null> {
    const list = await this.all();
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((e) => e.id !== id);
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

const svc = new EventsService();

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  await ensureSeeded(svc);

  app.get<{ Querystring: { from?: string; to?: string } }>("/events", async (req) => {
    const from = req.query.from ? parseInt(req.query.from, 10) : 0;
    const to = req.query.to ? parseInt(req.query.to, 10) : Date.now() + 365 * 86400_000;
    const list = await svc.listBetween(from, to);
    return { events: list, total: list.length };
  });

  app.get<{ Params: { id: string } }>("/events/:id", async (req) => {
    const e = await svc.get(req.params.id);
    if (!e) throw E.val("EC-EVT-001", "Event no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return e;
  });

  app.post<{ Body: Partial<CalendarEvent> }>("/events", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.title || !b.start || !b.end) {
      throw E.val("EC-EVT-002", "title, start, end requeridos", { context: { body: b } });
    }
    const e = await svc.create({
      title: b.title,
      prof: b.prof ?? "",
      room: b.room ?? "",
      type: b.type ?? "",
      subject: b.subject ?? "",
      start: b.start,
      end: b.end,
    });
    reply.code(201);
    logOp("events", "created", true, { id: e.id, title: e.title });
    return e;
  });

  app.patch<{ Params: { id: string }; Body: Partial<CalendarEvent> }>("/events/:id", async (req) => {
    const e = await svc.update(req.params.id, req.body ?? {});
    if (!e) throw E.val("EC-EVT-003", "Event no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return e;
  });

  app.delete<{ Params: { id: string } }>("/events/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-EVT-004", "Event no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });
}

async function ensureSeeded(svc: EventsService) {
  const list = await svc.all();
  if (list.length > 0) return;
  const today = (h: number, m = 0) => {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const seed: Array<Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">> = [
    { title: "Math", prof: "Mr. Meier", room: "301", type: "Homework", subject: "math", start: today(8, 0), end: today(9, 30) },
    { title: "Politics-economics", prof: "Fr. Stolz", room: "301", type: "Homework", subject: "pol", start: today(9, 55), end: today(11, 25) },
    { title: "Deutsch", prof: "Dr. Seibert", room: "207", type: "Referat", subject: "deu", start: today(11, 45), end: today(13, 15) },
    { title: "Physics", prof: "Dr. Müller", room: "211", type: "Homework", subject: "phy", start: today(14, 0), end: today(15, 0) },
    { title: "Chemistry", prof: "Dr. Müller", room: "301", type: "Lecture", subject: "che", start: today(15, 10), end: today(16, 10) },
  ];
  for (const s of seed) await svc.create(s);
}
