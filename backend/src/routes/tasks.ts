// tasks.ts: REST CRUD para to-do's.
// v1.1.0 — frontend Education Service

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
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
}

const DATA_FILE = join(process.cwd(), "data", "tasks.json");

class TasksService {
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

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  await ensureSeeded(svc);

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
